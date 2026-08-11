"""Resolve writable Agent paths in source and PyInstaller runtimes."""

import os
import sys


def component_dir():
    """Return the directory containing the current Service executable/module."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def agent_root():
    """Return the installation root shared by Service, Companion and data."""
    return os.path.dirname(component_dir())
