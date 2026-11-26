#!/usr/bin/env python3
"""Download NOAA IBTrACS if needed, train the AtmosScale cyclone model."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.cyclone_forecaster import training_main


if __name__ == "__main__":
    training_main()
