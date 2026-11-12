"""Automated workflow for posture dataset selection, auditing, LOSO training, and Agent deployment.

Subcommands:
- status: Inspect datasets/pilot/ and show per-subject, per-class readiness for LOSO training.
- sync-selection: Automatically populate accepted_sessions.json and excluded_sessions from pilot manifests.
- guided-capture: Interactive step-by-step assistant that launches capture_landmarks.py for missing sessions.
- build-all: Run sync-selection -> report_pilot_dataset -> train_posture_baseline -> build_posture_profile -> deploy to Agent.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = TRAINING_ROOT.parent
AGENT_ROOT = REPOSITORY_ROOT / "child-monitor-agent"
AGENT_COMPANION_ROOT = AGENT_ROOT / "companion"
AGENT_MODELS_DIR = AGENT_ROOT / "models"

for import_root in (TRAINING_ROOT, AGENT_COMPANION_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from data_collection.build_posture_profile import build_personal_profile
from data_collection.calibration_ui import write_json_atomic
from evaluation.report_pilot_dataset import (
    EXPECTED_LABELS_BY_CLASS,
    _record_conflicts,
    _shoulder_tilt_signed_degrees,
    audit_pilot_dataset,
    load_selection,
    render_markdown,
)
from posture_model import PRIMARY_CLASSES, extract_posture_features
from training.train_posture_baseline import (
    REQUIRED_QUALITY_GATE_VERSION,
    SUPPORTED_QUALITY_GATE_VERSIONS,
    load_selected_dataset,
    train_with_loso,
)


CLASS_INSTRUCTIONS_VI = {
    "good": (
        "Ngồi ĐÚNG tư thế chuẩn (good): Ngồi thẳng lưng, đầu thẳng, hai vai cân bằng. "
        "Chỉ cần camera thấy rõ ĐẦU (2 tai) và 2 VAI (không cần thấy hông)."
    ),
    "bad": (
        "Ngồi SAI tư thế (bad): Bất kỳ tư thế nào lệch khỏi tư thế chuẩn (cúi/rướn cổ > 25 độ, "
        "nghiêng lệch vai > 12 độ, hoặc gù lưng). Chỉ cần camera thấy rõ ĐẦU (2 tai) và 2 VAI."
    ),
}


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_sha256_sidecar(asset_path):
    asset_path = Path(asset_path).resolve()
    digest = _sha256(asset_path)
    sidecar = asset_path.with_name(f"{asset_path.name}.sha256")
    sidecar.write_text(f"{digest}\n", encoding="ascii")
    return sidecar, digest


def inspect_session(manifest_path, *, min_usable_records=12):
    """Evaluate whether a session in datasets/pilot is eligible for LOSO training."""
    manifest_path = Path(manifest_path).resolve()
    dataset_dir = manifest_path.parent
    session_id = manifest_path.name.removesuffix(".manifest.json")
    records_path = dataset_dir / f"{session_id}.landmarks.jsonl"

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {
            "session_id": session_id,
            "eligible": False,
            "reason": f"manifest lỗi JSON: {error}",
        }

    subject_id = manifest.get("subject_id")
    gate_version = manifest.get("quality_gate_version")
    status = manifest.get("status")
    sample_count = int(manifest.get("sample_count") or 0)

    if status != "completed":
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": f"trạng thái phiên là {status!r}, chưa hoàn tất",
        }
    if not records_path.is_file() or sample_count <= 0:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": "lần chạy thử không có record",
        }
    if gate_version not in SUPPORTED_QUALITY_GATE_VERSIONS:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": f"quality_gate_version {gate_version!r} không được hỗ trợ",
        }

    actual_hash = _sha256(records_path)
    if manifest.get("records_sha256") and manifest.get("records_sha256") != actual_hash:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": "checksum file record không khớp manifest",
        }

    binary_states = set()
    usable_records = 0
    unobservable_records = 0
    geometry_violations = 0
    total_records = 0

    try:
        with records_path.open("r", encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                total_records += 1
                record = json.loads(line)
                if record.get("transition"):
                    continue
                labels = frozenset(record.get("posture_labels") or ())
                binary_states.add("bad" if labels else "good")
                if _record_conflicts(record):
                    geometry_violations += 1
                pose = record.get("pose_landmarks") or []
                if labels & {"shoulder_tilt_left", "shoulder_tilt_right"}:
                    shoulder_angle = _shoulder_tilt_signed_degrees(record, pose)
                    if (
                        shoulder_angle is None
                        or abs(shoulder_angle) <= 12.0
                        or ("shoulder_tilt_left" in labels and shoulder_angle >= 0)
                        or ("shoulder_tilt_right" in labels and shoulder_angle <= 0)
                    ):
                        geometry_violations += 1
                if record.get("visibility_state") != "visible":
                    unobservable_records += 1
                    continue
                vector = extract_posture_features(
                    pose,
                    record.get("frame_width"),
                    record.get("frame_height"),
                )
                if vector is None:
                    unobservable_records += 1
                else:
                    usable_records += 1
    except (OSError, json.JSONDecodeError) as error:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": f"file record lỗi định dạng: {error}",
        }

    if total_records != sample_count:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": f"số dòng record ({total_records}) lệch sample_count ({sample_count})",
        }
    if len(binary_states) != 1:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "eligible": False,
            "reason": "phiên trộn lẫn cả ngồi đúng (good) và sai tư thế (bad)",
        }

    primary_class = next(iter(binary_states))
    if geometry_violations > 0:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "primary_class": primary_class,
            "eligible": False,
            "reason": f"có {geometry_violations} record chưa đạt ngưỡng góc nghiêng vai (> 12 độ)",
        }
    if unobservable_records > 0:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "primary_class": primary_class,
            "eligible": False,
            "reason": f"có {unobservable_records} record thiếu visibility 2 tai hoặc 2 vai",
        }
    if usable_records < min_usable_records:
        return {
            "session_id": session_id,
            "subject_id": subject_id,
            "primary_class": primary_class,
            "eligible": False,
            "reason": f"chỉ có {usable_records} record hợp lệ (cần tối thiểu {min_usable_records})",
        }

    return {
        "session_id": session_id,
        "subject_id": subject_id,
        "camera_id": manifest.get("camera_id"),
        "primary_class": primary_class,
        "sample_count": total_records,
        "usable_records": usable_records,
        "records_sha256": actual_hash,
        "started_at": manifest.get("started_at") or "",
        "eligible": True,
        "reason": None,
    }


def scan_pilot_directory(dataset_dir, *, min_usable_records=12):
    dataset_dir = Path(dataset_dir).resolve()
    manifest_paths = sorted(dataset_dir.glob("*.manifest.json"))
    inspected = [
        inspect_session(path, min_usable_records=min_usable_records)
        for path in manifest_paths
    ]
    eligible = [item for item in inspected if item.get("eligible")]
    ineligible = [item for item in inspected if not item.get("eligible")]
    return eligible, ineligible


def sync_selection_file(
    dataset_dir,
    selection_path=None,
    *,
    dataset_id="posture-pilot-loso-v2",
    min_usable_records=12,
):
    """Build and write accepted_sessions.json from all eligible v2.0.0 sessions."""
    dataset_dir = Path(dataset_dir).resolve()
    if selection_path is None:
        selection_path = dataset_dir / "accepted_sessions.json"
    selection_path = Path(selection_path).resolve()

    existing_exclusions = {}
    if selection_path.is_file():
        try:
            old_data = json.loads(selection_path.read_text(encoding="utf-8"))
            for item in old_data.get("excluded_sessions", []):
                if item.get("session_id") and item.get("reason"):
                    existing_exclusions[item["session_id"]] = item["reason"]
        except (OSError, json.JSONDecodeError):
            pass

    eligible, ineligible = scan_pilot_directory(
        dataset_dir,
        min_usable_records=min_usable_records,
    )

    accepted_sessions = []
    for item in sorted(
        eligible,
        key=lambda x: (
            x["subject_id"],
            PRIMARY_CLASSES.index(x["primary_class"]),
            x["session_id"],
        ),
    ):
        accepted_sessions.append(
            {
                "session_id": item["session_id"],
                "primary_class": item["primary_class"],
                "expected_sample_count": item["sample_count"],
                "expected_records_sha256": item["records_sha256"],
                "acceptance_note": (
                    f"Quality gate {REQUIRED_QUALITY_GATE_VERSION} xác nhận đủ "
                    f"tai/vai/hông cho {item['subject_id']} ({item['primary_class']})."
                ),
            }
        )

    excluded_sessions = []
    seen_excluded = set()
    for item in sorted(ineligible, key=lambda x: x["session_id"]):
        session_id = item["session_id"]
        seen_excluded.add(session_id)
        reason = existing_exclusions.get(session_id) or item["reason"]
        excluded_sessions.append(
            {
                "session_id": session_id,
                "reason": reason,
            }
        )

    selection = {
        "selection_version": "1.0.0",
        "dataset_id": dataset_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "selection_policy": (
            "Chọn tất cả các phiên tĩnh đơn lớp đạt quality gate 2.0.0 (đủ visibility "
            "tai, vai, hông); loại các phiên thử hoặc phiên thiếu keypoint."
        ),
        "accepted_sessions": accepted_sessions,
        "excluded_sessions": excluded_sessions,
    }
    if accepted_sessions:
        write_json_atomic(selection_path, selection)
    return selection, eligible, ineligible


def compute_readiness(eligible_sessions, *, target_subjects=("subject-001", "subject-002", "subject-003")):
    """Return a structured readiness matrix by subject and posture class."""
    by_subject_class = defaultdict(lambda: defaultdict(list))
    for session in eligible_sessions:
        by_subject_class[session["subject_id"]][session["primary_class"]].append(session)

    all_subjects = sorted(set(target_subjects) | set(by_subject_class.keys()))
    matrix = {}
    missing_plan = []

    for subject_id in all_subjects:
        matrix[subject_id] = {}
        for class_name in PRIMARY_CLASSES:
            sessions = by_subject_class[subject_id][class_name]
            count = len(sessions)
            total_records = sum(item["sample_count"] for item in sessions)
            min_records_target = 60 if class_name == "good" else 30
            is_ready = (count >= 2 or total_records >= 60) and (
                class_name != "good" or total_records >= 50
            )
            needed_sessions = 0 if is_ready else max(0, 2 - count)
            matrix[subject_id][class_name] = {
                "session_count": count,
                "total_records": total_records,
                "ready": is_ready,
                "needed_sessions": needed_sessions,
            }
            for _ in range(needed_sessions):
                missing_plan.append(
                    {
                        "subject_id": subject_id,
                        "primary_class": class_name,
                        "recommended_records": 30 if class_name == "good" else 20,
                    }
                )
            if count >= 2 and class_name == "good" and total_records < 50:
                missing_plan.append(
                    {
                        "subject_id": subject_id,
                        "primary_class": "good",
                        "recommended_records": 50 - total_records + 10,
                    }
                )

    ready_subjects = [
        subject_id
        for subject_id, classes in matrix.items()
        if all(info["ready"] for info in classes.values())
    ]
    return {
        "ready_for_loso": len(ready_subjects) >= 3,
        "ready_subjects": ready_subjects,
        "matrix": matrix,
        "missing_plan": missing_plan,
    }


def print_status_table(dataset_dir):
    eligible, ineligible = scan_pilot_directory(dataset_dir)
    readiness = compute_readiness(eligible)
    print("\n=== TRẠNG THÁI DỮ LIỆU TƯ THẾ 2 NHÃN: ĐÚNG (GOOD) & SAI (BAD) ===")
    print(f"Thư mục: {Path(dataset_dir).resolve()}")
    print(f"Phiên hợp lệ (v2.0.0): {len(eligible)} | Phiên cũ/loại trừ: {len(ineligible)}")
    print("-" * 72)
    header = (
        f"{'Subject':<14} | "
        + " | ".join(f"{cls + ' (2 phiên)':<18}" for cls in PRIMARY_CLASSES)
        + " | Trạng thái"
    )
    print(header)
    print("-" * 72)
    for subject_id, classes in readiness["matrix"].items():
        cells = []
        for cls in PRIMARY_CLASSES:
            info = classes[cls]
            cells.append(f"{info['session_count']}/2 ({info['total_records']} mẫu)".ljust(18))
        status_str = "ĐẠT" if subject_id in readiness["ready_subjects"] else "THIẾU"
        print(f"{subject_id:<14} | " + " | ".join(cells) + f" | {status_str}")
    print("-" * 72)
    print(
        f"Sẵn sàng huấn luyện LOSO (>= 3 subjects): "
        f"{'CÓ' if readiness['ready_for_loso'] else 'CHƯA'} "
        f"({len(readiness['ready_subjects'])}/3 subjects hoàn tất)\n"
    )
    return readiness


def run_full_build(
    dataset_dir,
    *,
    output_model_path=None,
    output_report_path=None,
    deploy_to_agent=True,
    profile_subject_id="subject-001",
):
    """Sync selection, audit dataset, train LOSO model, build profiles, and deploy."""
    dataset_dir = Path(dataset_dir).resolve()
    selection_path = dataset_dir / "accepted_sessions.json"
    output_model_path = Path(
        output_model_path or (TRAINING_ROOT / "artifacts" / "posture_baseline_v1.json")
    ).resolve()
    output_report_path = Path(
        output_report_path or (TRAINING_ROOT / "artifacts" / "posture_loso_report.json")
    ).resolve()

    selection, eligible, _ = sync_selection_file(dataset_dir, selection_path)
    readiness = compute_readiness(eligible)
    if not readiness["ready_for_loso"]:
        missing_count = len(readiness["missing_plan"])
        raise ValueError(
            f"Chưa đủ dữ liệu chuẩn Quality Gate 2.0.0 để huấn luyện LOSO "
            f"(còn thiếu {missing_count} phiên thu; chạy 'status' hoặc 'guided-capture' để xem chi tiết)."
        )

    # 1. Audit pilot dataset and write reports
    validated_selection = load_selection(selection_path)
    pilot_report = audit_pilot_dataset(dataset_dir, validated_selection)
    if pilot_report["status"] == "failed":
        raise ValueError(
            "Kiểm định dataset thất bại: " + "; ".join(pilot_report["errors"])
        )
    pilot_json_path = dataset_dir / "pilot_dataset_report.json"
    pilot_md_path = dataset_dir / "pilot_dataset_report.md"
    write_json_atomic(pilot_json_path, pilot_report)
    pilot_md_path.write_text(render_markdown(pilot_report), encoding="utf-8")

    # 2. Train LOSO baseline model
    samples, good_vectors, sessions = load_selected_dataset(selection_path)
    model, loso_report = train_with_loso(samples, good_vectors)
    loso_report["sessions"] = sessions
    write_json_atomic(output_model_path, model)
    write_json_atomic(output_report_path, loso_report)
    _write_sha256_sidecar(output_model_path)

    # 3. Build personal profiles for all ready subjects
    built_profiles = {}
    for subject_id in readiness["ready_subjects"]:
        profile_path, profile_data = build_personal_profile(
            selection_path,
            subject_id,
            dataset_dir / f"{subject_id}.posture-profile.json",
        )
        _write_sha256_sidecar(profile_path)
        built_profiles[subject_id] = profile_path

    # 4. Deploy approved model & primary subject profile to Agent models directory
    deployed_files = []
    if deploy_to_agent and model.get("deployment_approved") is True:
        AGENT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        agent_model_target = AGENT_MODELS_DIR / "posture_baseline_v1.json"
        shutil.copyfile(output_model_path, agent_model_target)
        _write_sha256_sidecar(agent_model_target)
        deployed_files.append(agent_model_target)

        if profile_subject_id in built_profiles:
            agent_profile_target = AGENT_MODELS_DIR / "posture_profile_v1.json"
            shutil.copyfile(built_profiles[profile_subject_id], agent_profile_target)
            _write_sha256_sidecar(agent_profile_target)
            deployed_files.append(agent_profile_target)

    return {
        "pilot_report": pilot_report,
        "model": model,
        "loso_report": loso_report,
        "output_model_path": output_model_path,
        "output_report_path": output_report_path,
        "built_profiles": built_profiles,
        "deployed_files": deployed_files,
    }


def run_guided_capture(args):
    dataset_dir = Path(args.dataset_dir).resolve()
    readiness = print_status_table(dataset_dir)
    plan = readiness["missing_plan"]
    if args.subject_id:
        plan = [item for item in plan if item["subject_id"] == args.subject_id]

    if not plan:
        print("Tất cả các phiên mục tiêu đã đủ! Đang chạy kiểm định và huấn luyện...")
        result = run_full_build(dataset_dir)
        print(f"Hoàn tất! Model: {result['output_model_path']}")
        return 0

    capture_script = TRAINING_ROOT / "data_collection" / "capture_landmarks.py"
    print(f"Cần thu thêm {len(plan)} phiên ngắn (mỗi phiên chỉ khoảng 10-15 giây).")
    print("Lưu ý: Chỉ cần ngồi tự nhiên trước laptop sao cho webcam thấy rõ ĐẦU (2 tai) và 2 VAI.\n")

    for index, task in enumerate(plan, start=1):
        subject_id = task["subject_id"]
        primary_class = task["primary_class"]
        records = args.records_per_session or task["recommended_records"]
        print("=" * 78)
        print(f"[{index}/{len(plan)}] Người thu: {subject_id} | Lớp: {primary_class} | Số mẫu: {records}")
        print(f"Hướng dẫn: {CLASS_INSTRUCTIONS_VI[primary_class]}")
        print("Nhãn đã được chọn sẵn tự động! Khi cửa sổ mở ra:")
        print("  1. Ngồi đúng tư thế để dòng 'Capture quality: READY' hiện màu XANH LÁ.")
        print("  2. Nhấn phím SPACE để bắt đầu thu (tự đóng khi đủ mẫu).")
        answer = input("Nhấn Enter để mở Webcam (hoặc gõ 's' để bỏ qua, 'q' để thoát): ").strip().lower()
        if answer == "q":
            break
        if answer == "s":
            continue

        cmd = [
            sys.executable,
            str(capture_script),
            "--subject-id",
            subject_id,
            "--initial-class",
            primary_class,
            "--sample-rate-hz",
            str(args.sample_rate_hz),
            "--max-records",
            str(records),
            "--camera-index",
            str(args.camera_index),
            "--output-dir",
            str(dataset_dir),
        ]
        subprocess.run(cmd, check=False)

    print_status_table(dataset_dir)
    sync_selection_file(dataset_dir)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        description="Quản lý quy trình thu nhanh, kiểm định và huấn luyện LOSO cho Model Tư thế."
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=TRAINING_ROOT / "datasets" / "pilot",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("status", help="Xem bảng tiến độ dữ liệu theo từng subject và lớp tư thế.")
    subparsers.add_parser("sync-selection", help="Tự động cập nhật accepted_sessions.json từ các phiên hợp lệ.")

    capture_parser = subparsers.add_parser(
        "guided-capture",
        help="Hướng dẫn thu liên hoàn các phiên còn thiếu với nhãn được chọn sẵn.",
    )
    capture_parser.add_argument("--subject-id", help="Chỉ thu cho một subject cụ thể (ví dụ: subject-001).")
    capture_parser.add_argument("--camera-index", type=int, default=0)
    capture_parser.add_argument("--sample-rate-hz", type=float, default=2.0)
    capture_parser.add_argument("--records-per-session", type=int, default=0)

    build_parser_cmd = subparsers.add_parser(
        "build-all",
        help="Đồng bộ selection, xuất báo cáo kiểm định, huấn luyện LOSO và triển khai sang Agent.",
    )
    build_parser_cmd.add_argument("--profile-subject-id", default="subject-001")
    build_parser_cmd.add_argument("--no-deploy", action="store_true")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    command = args.command or "status"

    if command == "status":
        print_status_table(args.dataset_dir)
        return 0
    if command == "sync-selection":
        selection, eligible, ineligible = sync_selection_file(args.dataset_dir)
        print(
            f"Đã đồng bộ accepted_sessions.json: "
            f"{len(eligible)} phiên hợp lệ, {len(ineligible)} phiên loại trừ."
        )
        print_status_table(args.dataset_dir)
        return 0
    if command == "guided-capture":
        return run_guided_capture(args)
    if command == "build-all":
        try:
            result = run_full_build(
                args.dataset_dir,
                deploy_to_agent=not args.no_deploy,
                profile_subject_id=args.profile_subject_id,
            )
        except ValueError as error:
            parser.error(str(error))
        loso = result["loso_report"]
        print(f"Đã lưu báo cáo kiểm định pilot: {args.dataset_dir / 'pilot_dataset_report.md'}")
        print(f"Đã lưu model tư thế: {result['output_model_path']}")
        print(f"Đã lưu báo cáo LOSO: {result['output_report_path']}")
        print(f"Mean LOSO Accuracy: {loso['mean_accuracy']:.2%}")
        print(f"Mean Macro Recall: {loso['mean_macro_recall']:.2%}")
        print(f"Conclusive Accuracy: {loso['mean_conclusive_accuracy']:.2%}")
        print(f"Conclusive Coverage: {loso['mean_conclusive_coverage']:.2%}")
        print(f"Deployment Approved: {result['model']['deployment_approved']}")
        if result["deployed_files"]:
            print("Đã triển khai sang Agent models:")
            for path in result["deployed_files"]:
                print(f"  - {path}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
