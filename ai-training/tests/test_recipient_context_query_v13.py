"""Feature semantics and transport fixtures; not training or accuracy data."""
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence.context_query_model_v13 import ALGORITHM, context_features, query_features
from school_violence.experiment_role_context_v11 import fit
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


class RecipientContextTests(unittest.TestCase):
    def test_preparation_equipment_and_secret_do_not_create_passive_harm(self):
        for text in ("Chuẩn bị đọc sách", "Em giữ bí mật", "Thiết bị học tập", "Em chuan bi hoc"):
            self.assertNotIn("ctx:affected", context_features(text))
        self.assertIn("ctx:affected", context_features("Em chuẩn bị về thì bị đánh"))
        self.assertIn("ctx:affected", context_features("Em bi danh"))

    def test_progress_tracking_is_distinct_from_money_demands(self):
        for text in ("Theo dõi tiến độ công việc", "theo doi tien do cong viec"):
            self.assertNotIn("ctx:money_coercion", context_features(text))
        for text in ("Một người đòi tiền em", "mot nguoi doi tien em"):
            self.assertIn("ctx:money_coercion", context_features(text))

    def test_long_observed_passive_scopes_the_action(self):
        features = context_features("Em thấy một học sinh bị cả nhóm bao quanh giữ chặt chân rồi đánh")
        self.assertIn("ctx:witness+physical", features)
        self.assertIn("ctx:other_affected+physical", features)
        self.assertNotIn("ctx:physical", features)
        self.assertNotIn("ctx:self_affected", features)

    def test_pressure_on_friend_carries_recipient_into_following_threat(self):
        features = context_features("Một người ép bạn của em chuyển tiền và đe dọa")
        self.assertIn("ctx:witness+threat", features)
        self.assertIn("ctx:observed_pressure_mode:coercion", features)
        self.assertNotIn("ctx:threat", features)
        self.assertNotIn("ctx:pressure_mode:coercion", features)

    def test_observation_does_not_erase_explicit_harm_to_self(self):
        features = context_features("Em thấy bạn bị đánh; sau đó họ đánh em")
        self.assertIn("ctx:witness+physical", features)
        self.assertIn("ctx:self_affected+physical", features)
        self.assertIn("ctx:physical", features)

    def test_request_recipient_is_distinct_from_harm_recipient(self):
        features = context_features("Bạn yêu cầu em giải thích")
        self.assertIn("ctx:pressure_recipient:self_affected", features)
        self.assertNotIn("ctx:self_affected", features)
        self.assertIn("ctx:self_affected", context_features("Bạn yêu cầu em giải thích rồi đánh em"))

    def test_boundary_wording_and_academic_context_can_coexist(self):
        features = context_features("Các bạn gây áp lực để em thay đổi đánh giá")
        self.assertIn("ctx:interpersonal_boundary+pressure", features)
        self.assertIn("ctx:academic_action", features)
        self.assertIn("ctx:pressure", features)
        self.assertNotIn("ctx:physical", features)

    def test_financial_features_are_retained(self):
        self.assertIn("ctx:self_affected+money_coercion", context_features("Em luôn phải mua đồ cho nhóm bạn"))
        self.assertIn("ctx:money_coercion", context_features("Bạn giữ lại ví nếu em không làm theo yêu cầu"))

    def test_recipient_features_do_not_override_learned_output(self):
        for label in LABELS:
            prior = {key: 0.8 if key == label else 0.1 for key in LABELS}
            model = dict(algorithm=ALGORITHM, labels=list(LABELS), head=dict(
                labels=list(LABELS), features={}, bias=[0, 0, 0], fallback_prior=prior))
            self.assertEqual(select_label(model, predict_scores(model, "Em thấy bạn bị đánh")), label)

    def test_serialized_head_matches_service(self):
        rows = [dict(text=text, label=label) for text, label in (
            ("Em đọc bài", "SAFE"), ("Bạn chê bài của em", "RISK"), ("Bạn đánh em", "HIGH_RISK"))]
        model = fit(rows, feature_keys=query_features, algorithm=ALGORITHM)
        model.update(model_version="recipient-feature-test", deployment_eligible=False)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for i, row in enumerate(rows):
                scores = predict_scores(model, row["text"])
                result = engine.moderate(ModerationInput(str(i), row["text"], "search_query"))
                self.assertEqual(result["scores"], scores)
                self.assertEqual(result["label"], select_label(model, scores))
                self.assertAlmostEqual(sum(scores.values()), 1.0)


if __name__ == "__main__":
    unittest.main()
