"""Resolve read-only Agent assets in source and PyInstaller runtimes."""

import os
import sys

if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def component_dir():
    """Return the directory containing the current Companion executable/module."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def agent_root():
    """Return the installation root shared by Service, Companion and models."""
    return os.path.dirname(component_dir())
