"""Compatibility CLI for the three-label school-violence trainer.

Running ``python -m text_safety.training`` trains SAFE/RISK/HIGH_RISK only.
"""

from school_violence.training import LABELS, main, run

__all__ = ["LABELS", "run", "main"]


if __name__ == "__main__":
    main()
