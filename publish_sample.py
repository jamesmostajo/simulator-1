"""
Copies one run from results/ into ui/sample/ so it can be committed and shown on GitHub Pages
(results/ is git-ignored, and GitHub Pages can only serve committed files).

    python3 publish_sample.py                      # publishes the newest run
    python3 publish_sample.py 20261111-232220_seed2026   # publishes a specific run

Any previously published sample is replaced, so only one sample run is kept.
"""
import os
import shutil
import sys

from Results import update_index

RESULTS_ROOT = "results"
SAMPLE_ROOT = os.path.join("ui", "sample")
REQUIRED_FILES = ["run.json", "agents.csv", "log_stack.npy", "outcomes.npy", "hidden_states.npy"]


def newest_run():
    runs = [name for name in os.listdir(RESULTS_ROOT) if os.path.isfile(os.path.join(RESULTS_ROOT, name, "run.json"))]
    if not runs:
        sys.exit("No runs in results/. Run python3 Main.py first.")
    return max(runs)  # run folders start with a sortable timestamp


def main():
    run_name = sys.argv[1] if len(sys.argv) > 1 else newest_run()
    source = os.path.join(RESULTS_ROOT, run_name)
    missing = [f for f in REQUIRED_FILES if not os.path.isfile(os.path.join(source, f))]
    if missing:
        sys.exit(f"{source} is missing {', '.join(missing)} (runs saved before the .npy format can't be published).")

    if os.path.isdir(SAMPLE_ROOT):
        shutil.rmtree(SAMPLE_ROOT)
    os.makedirs(SAMPLE_ROOT)
    shutil.copytree(source, os.path.join(SAMPLE_ROOT, run_name))
    update_index(SAMPLE_ROOT)
    print(f"published {run_name} to {SAMPLE_ROOT}/")


if __name__ == "__main__":
    main()
