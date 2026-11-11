"""
Saves a finished run in a standard format, one folder per run:

    results/<timestamp>_seed<master seed>/
        run.json          settings of the run (seed, game, grids, rounds, versions)
        agents.csv        one row per agent: its settings and final metrics
        log_stack.npy     (agents x rounds + 1) float64, natural log of each agent's stack,
                          row i is the agent with agent_id i in agents.csv,
                          column 0 is the start, column t + 1 is after round t,
                          NaN after the agent went bankrupt
        outcomes.npy      (rounds,) int8, each flip, 0 heads / 1 tails
        hidden_states.npy (rounds,) int8, coin that produced each flip

    results/index.json    list of every run in the folder, newest first (used by the ui)

Plain .npy files are used (not .npz) so the browser ui can read them directly.

Loading it back:
    import json, numpy as np, pandas as pd
    run = json.load(open(f"{run_dir}/run.json"))
    agents = pd.read_csv(f"{run_dir}/agents.csv")
    log_stack = np.load(f"{run_dir}/log_stack.npy")
"""
import csv
import datetime
import json
import os
import platform
import subprocess

import numpy as np


def _git_commit():
    # commit the code was run from, with "-dirty" if there were uncommitted changes
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=True).stdout.strip()
        return commit + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return None


def agent_summary(agent_id, agent):
    wins, skips, losses = agent.output_stats
    bets = wins + losses
    return {
        "agent_id": agent_id,
        **agent.agent_info,
        "label": " ".join(sorted(map(str, agent.agent_type))),
        "initial_log_stack": agent.initial_log_stack,
        "final_log_stack": agent.log_stack,
        "final_log_growth": agent.log_stack - agent.initial_log_stack,
        "bankrupt": agent.bankrupt,
        "bankrupt_round": agent.bankrupt_round if agent.bankrupt else "",
        "rounds_played": len(agent.log_stack_history) - 1,
        "bets": bets,
        "wins": wins,
        "losses": losses,
        "skips": skips,
        "win_rate": wins / bets if bets > 0 else "",
    }


def save_results(agents, simulator, run_info, output_root="results"):
    created_at = datetime.datetime.now()
    run_dir = os.path.join(output_root, f"{created_at:%Y%m%d-%H%M%S}_seed{run_info['master_seed']}")
    os.makedirs(run_dir, exist_ok=False)
    number_rounds = len(simulator.time_series)

    # run.json
    run_metadata = {
        **run_info,
        "number_rounds": number_rounds,
        "number_agents": len(agents),
        "created_at": created_at.isoformat(timespec="seconds"),
        "git_commit": _git_commit(),
        "python_version": platform.python_version(),
        "numpy_version": np.__version__,
    }
    with open(os.path.join(run_dir, "run.json"), "w") as f:
        json.dump(run_metadata, f, indent=2)

    # agents.csv: agent_id, then every setting any agent has, then the metrics
    rows = [agent_summary(agent_id, agent) for agent_id, agent in enumerate(agents)]
    setting_columns = dict.fromkeys(key for agent in agents for key in agent.agent_info)
    columns = list(dict.fromkeys(["agent_id", *setting_columns, *rows[0].keys()]))
    with open(os.path.join(run_dir, "agents.csv"), "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, restval="")
        writer.writeheader()
        writer.writerows(rows)

    # per-round data
    log_stack = np.full((len(agents), number_rounds + 1), np.nan)
    for agent_id, agent in enumerate(agents):
        log_stack[agent_id, :len(agent.log_stack_history)] = agent.log_stack_history
    np.save(os.path.join(run_dir, "log_stack.npy"), log_stack)
    np.save(os.path.join(run_dir, "outcomes.npy"), np.array([outcome for outcome, _ in simulator.time_series], dtype=np.int8))
    np.save(os.path.join(run_dir, "hidden_states.npy"), np.array([state for _, state in simulator.time_series], dtype=np.int8))

    update_index(output_root)
    return run_dir


def update_index(output_root="results"):
    # rebuilds results/index.json from every run folder that has a run.json
    runs = []
    for name in os.listdir(output_root):
        run_file = os.path.join(output_root, name, "run.json")
        if os.path.isfile(run_file):
            with open(run_file) as f:
                run = json.load(f)
            runs.append({
                "run": name,
                "created_at": run.get("created_at"),
                "master_seed": run.get("master_seed"),
                "number_rounds": run.get("number_rounds"),
                "number_agents": run.get("number_agents"),
            })
    runs.sort(key=lambda run: run["created_at"] or "", reverse=True)
    with open(os.path.join(output_root, "index.json"), "w") as f:
        json.dump(runs, f, indent=2)
