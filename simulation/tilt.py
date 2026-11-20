"""Run the NC-04 tilt load checks or play them in the MuJoCo viewer."""

import argparse
import json
from math import degrees, hypot, radians
from pathlib import Path
from time import sleep

import mujoco

ANGLES = (15, 30, 45)
PIN_RADIUS = hypot(0.012, 0.014)
TOUCH_FORCE = 5.0
TOUCH_HEIGHT = 0.070


def set_pose(model, data, angle, locked):
    mujoco.mj_resetData(model, data)
    data.joint("tilt").qpos[0] = radians(angle)
    data.mocap_pos[0, 0] += 0.0 if locked else -0.05
    if locked:
        data.eq_active[model.equality(f"lock_{angle}").id] = True
    mujoco.mj_forward(model, data)


def checks(model, data, tick=lambda: None):
    locks = []
    for target in ANGLES:
        set_pose(model, data, target, locked=True)
        for force in (0.0, TOUCH_FORCE):
            # A screen-normal push at 70 mm above the hinge has a constant lever arm.
            data.qfrc_applied[0] = force * TOUCH_HEIGHT
            for _ in range(750):
                mujoco.mj_step(model, data)
                tick()
            error = abs(degrees(data.qpos[0]) - target)
            # Constraint includes the travel stop at the endpoints. Compute the
            # equivalent load on a pin carrying the full static hinge torque.
            torque = abs(data.qfrc_bias[0] - data.qfrc_applied[0])
            print(f"{target:2d}°  {force:g} N  error {error:.4f}°  "
                  f"hinge {torque:.3f} N·m  equivalent pin load {torque / PIN_RADIUS:.1f} N")
            locks.append({"angle": target, "force": force, "error": round(error, 4),
                          "pinLoad": round(torque / PIN_RADIUS, 1)})
            if error > 0.25 or abs(data.qvel[0]) > 0.01:
                raise RuntimeError(f"Tilt lock did not settle at {target}°")

    set_pose(model, data, 15, locked=False)
    release = [[0, 15]]
    for step in range(1, 1501):
        mujoco.mj_step(model, data)
        if step % 10 == 0:
            release.append([round(data.time * 1000), round(degrees(data.qpos[0]), 3)])
        tick()
    angle = degrees(data.qpos[0])
    print(f"Pin withdrawn, released at 15°: {angle:.2f}° under gravity")
    if abs(angle - 45) > 0.25 or abs(data.qvel[0]) > 0.01:
        raise RuntimeError("Released cradle did not settle at the travel limit")
    return {"locks": locks, "release": release}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--view", action="store_true", help="Replay the checks in the native viewer")
    parser.add_argument("--export", type=Path, help="Write the measured load cases and motion samples to JSON")
    options = parser.parse_args()
    model = mujoco.MjModel.from_xml_path(str(Path(__file__).with_name("nc04-tilt.xml")))
    data = mujoco.MjData(model)
    if not options.view:
        result = checks(model, data)
        if options.export:
            options.export.write_text(json.dumps(result, separators=(",", ":")) + "\n")
        return

    from mujoco import viewer

    with viewer.launch_passive(model, data) as window:
        def render():
            if not window.is_running():
                raise SystemExit
            if round(data.time / model.opt.timestep) % 16 == 0:
                window.sync()
                sleep(0.016)
        while window.is_running():
            checks(model, data, render)


if __name__ == "__main__":
    main()
