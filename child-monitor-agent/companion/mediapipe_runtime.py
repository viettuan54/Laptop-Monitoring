"""Load MediaPipe Tasks without its unused Matplotlib drawing dependency."""

import importlib
import sys
import types


def load_mediapipe():
    """Import MediaPipe while omitting optional Matplotlib 3D plotting.

    MediaPipe 0.10.33 imports ``vision.drawing_utils`` unconditionally, and
    that module imports Matplotlib solely for ``plot_landmarks``. Child Monitor
    draws its preview with OpenCV and never calls that plotting function. A
    short-lived pyplot stub prevents an unnecessary native Matplotlib PYD from
    being loaded, which also keeps the runtime compatible with Windows
    Application Control policies that reject that optional binary.
    """
    existing = sys.modules.get("mediapipe")
    if existing is not None:
        return existing

    pyplot_name = "matplotlib.pyplot"
    matplotlib_name = "matplotlib"
    created_pyplot = pyplot_name not in sys.modules
    created_matplotlib = matplotlib_name not in sys.modules
    matplotlib_module = sys.modules.get(matplotlib_name)
    previous_pyplot_attribute = None
    had_pyplot_attribute = False

    if created_pyplot:
        pyplot_stub = types.ModuleType(pyplot_name)
        sys.modules[pyplot_name] = pyplot_stub
        if created_matplotlib:
            matplotlib_module = types.ModuleType(matplotlib_name)
            matplotlib_module.__path__ = []
            sys.modules[matplotlib_name] = matplotlib_module
        else:
            had_pyplot_attribute = hasattr(matplotlib_module, "pyplot")
            previous_pyplot_attribute = getattr(
                matplotlib_module,
                "pyplot",
                None,
            )
        matplotlib_module.pyplot = pyplot_stub

    try:
        return importlib.import_module("mediapipe")
    finally:
        if created_pyplot:
            sys.modules.pop(pyplot_name, None)
            if created_matplotlib:
                sys.modules.pop(matplotlib_name, None)
            elif had_pyplot_attribute:
                matplotlib_module.pyplot = previous_pyplot_attribute
            else:
                try:
                    delattr(matplotlib_module, "pyplot")
                except AttributeError:
                    pass
