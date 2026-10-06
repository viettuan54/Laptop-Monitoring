"""Measure query-only inference in a fresh process without training dependencies."""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import statistics
import time
from pathlib import Path

from text_safety.engine import ModerationInput, ThreeLabelEngine


def windows_memory(pid: int | None = None) -> dict:
    if os.name != "nt":
        return {"available": False}
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel.OpenProcess(0x1000 | 0x10, False, pid or os.getpid())
    if not handle:
        return {"available": False, "error": ctypes.get_last_error()}
    try:
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        psapi.GetProcessMemoryInfo.argtypes = (wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return {"available": False, "error": ctypes.get_last_error()}
        return {"available": True, "rss_mib": counters.WorkingSetSize / 2 ** 20,
                "peak_rss_mib": counters.PeakWorkingSetSize / 2 ** 20,
                "private_commit_mib": counters.PrivateUsage / 2 ** 20}
    finally:
        kernel.CloseHandle(handle)


def summarize_ms(values: list[float]) -> dict:
    ordered = sorted(values)
    return {"samples": len(values), "mean_ms": statistics.mean(values),
            "median_ms": statistics.median(values),
            "p95_ms": ordered[math.ceil(0.95 * len(ordered)) - 1],
            "max_ms": ordered[-1]}


def run(model_path: Path, input_path: Path) -> dict:
    rows = json.loads(input_path.read_text(encoding="utf-8"))
    before = windows_memory()
    started = time.perf_counter()
    engine = ThreeLabelEngine(model_path)
    load_ms = (time.perf_counter() - started) * 1000
    items = [ModerationInput(row["id"], row["text"], "search_query") for row in rows]
    predictions = engine.moderate_batch(items)
    timings = []
    for _ in range(8):
        for item in items:
            started = time.perf_counter()
            engine.moderate(item)
            timings.append((time.perf_counter() - started) * 1000)
    lengths = [len(row["text"]) for row in rows]
    return {"model": engine.model_version, "model_load_excluding_python_imports_ms": load_ms,
            "query_length_characters": {"min": min(lengths), "mean": statistics.mean(lengths),
                                        "max": max(lengths)},
            "inference": summarize_ms(timings), "memory_before_load": before,
            "memory_after_warm_inference": windows_memory(),
            "predictions": [{"id": row["id"], "label": row["label"], "scores": row["scores"]}
                            for row in predictions]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.model, args.input)))


if __name__ == "__main__":
    main()
