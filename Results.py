"""
Saves a finished run in a standard format, one folder per run:

    results/<timestamp>_seed<master seed>/
        run.json          settings of the run (seed, game, grids, rounds, versions)
        agents.csv        one row per agent: its settings and final metrics
        trajectories.npz  per-round data:
                            log_stack      (agents x rounds + 1) natural log of each agent's stack,
                                           column 0 is the start, column t + 1 is after round t,
                                           NaN after the agent went bankrupt
                            agent_id       (agents,) row order of log_stack, matches agents.csv
                            outcomes       (rounds,) each flip, 0 heads / 1 tails
                            hidden_states  (rounds,) coin that produced each flip

Loading it back:
    import json, numpy as np, pandas as pd
    run = json.load(open(f"{run_dir}/run.json"))
    agents = pd.read_csv(f"{run_dir}/agents.csv")
    data = np.load(f"{run_dir}/trajectories.npz")
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

    # trajectories.npz
    log_stack = np.full((len(agents), number_rounds + 1), np.nan)
    for agent_id, agent in enumerate(agents):
        log_stack[agent_id, :len(agent.log_stack_history)] = agent.log_stack_history
    np.savez_compressed(
        os.path.join(run_dir, "trajectories.npz"),
        log_stack=log_stack,
        agent_id=np.arange(len(agents)),
        outcomes=np.array([int(outcome) for outcome, _ in simulator.time_series]),
        hidden_states=np.array([int(state) for _, state in simulator.time_series]),
    )

    return run_dir
