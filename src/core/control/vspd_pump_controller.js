const { clamp } = require("./clamp");
const { rampTo } = require("./ramp");
const { ema } = require("./ema");
const { piStep } = require("./pi");

/**
 * Variable-speed pump controller (RUN contact + speed reference).
 *
 * State machine:
 *   OFF -> STARTING -> KICKSTART -> RUNNING -> STOPPING -> OFF
 *
 * NEW v19:
 *   - KICKSTART: pump κάνει burst στο maxSpeed για cfg.kickstartS sec
 *     (ξεκαθαρίζει αέρα από collector), μετά ramp στο minSpeed.
 *     cfg.kickstartS = 0 → disabled.
 *
 *   - Anti-cycling: μετά από STOP, ο pump δεν μπορεί να ξεκινήσει για
 *     cfg.antiCycleS sec. Αποφεύγει rapid on/off όταν ΔΤ παίζει γύρω
 *     από το threshold.
 *     cfg.antiCycleS = 0 → disabled.
 */

function createVspdPumpController() {
  return {
    state: "OFF",
    lastTs: 0,
    speed: 0,
    iTerm: 0,
    dtFilt: null,
    phaseUntil: 0,
    antiCycleUntil: 0,   // NEW
  };
}

function updateVspdPump(ctrl, nowMs, input, cfg) {
  const now = nowMs || Date.now();

  // EMA filter on ΔT
  const dtRaw = input.tempSolar - input.tempBoiler;
  ctrl.dtFilt = (ctrl.dtFilt == null)
    ? dtRaw
    : ema(ctrl.dtFilt, dtRaw, cfg.emaAlpha ?? 0.25);
  const dt = ctrl.dtFilt;

  const antiCycleS = clamp(cfg.antiCycleS ?? 0, 0, 3600);

  const canRun =
    dt >= cfg.dtOn &&
    input.tempBoiler < cfg.maxTankTemp &&
    input.tempSolar  > cfg.minSolarTemp &&
    !input.fault &&
    now >= ctrl.antiCycleUntil;          // anti-cycle guard

  const shouldStop =
    dt <= cfg.dtOff ||
    input.tempBoiler >= cfg.maxTankTemp ||
    input.fault;

  // Target speed (PI or linear map)
  let targetSpeed = cfg.minSpeed;
  const dtS = Math.max(0.1, (now - (ctrl.lastTs || now)) / 1000);

  if (cfg.usePI) {
    const res = piStep({
      err:    cfg.dtTarget - dt,
      kp:     cfg.kp,
      ki:     cfg.ki,
      iTerm:  ctrl.iTerm,
      dtS,
      outMin: cfg.minSpeed,
      outMax: cfg.maxSpeed,
    });
    ctrl.iTerm  = res.iTerm;
    targetSpeed = res.out;
  } else {
    const e = cfg.dtTarget - dt;
    targetSpeed = clamp(
      cfg.minSpeed + (e * (cfg.mapGain ?? 6)),
      cfg.minSpeed,
      cfg.maxSpeed
    );
  }

  let reason = null;

  switch (ctrl.state) {

    case "OFF":
      ctrl.speed = 0;
      ctrl.iTerm = 0;
      if (canRun) {
        ctrl.state      = "STARTING";
        ctrl.phaseUntil = now + cfg.startDelayS * 1000;
        reason          = "START";
      }
      ctrl.lastTs = now;
      return { run: ctrl.state !== "OFF", speedPct: 0, state: ctrl.state, reason };

    case "STARTING":
      if (shouldStop) {
        ctrl.state      = "STOPPING";
        ctrl.phaseUntil = now + cfg.stopDelayS * 1000;
        reason          = "ABORT_START";
        ctrl.lastTs     = now;
        return { run: true, speedPct: ctrl.speed, state: ctrl.state, reason };
      }
      if (now >= ctrl.phaseUntil) {
        const kickSec = clamp(cfg.kickstartS ?? 0, 0, 300);
        if (kickSec > 0) {
          ctrl.state      = "KICKSTART";
          ctrl.speed      = clamp(cfg.kickstartPct ?? 40, cfg.minSpeed, cfg.maxSpeed);
          ctrl.phaseUntil = now + kickSec * 1000;
          reason          = "KICKSTART";
        } else {
          ctrl.state = "RUNNING";
          ctrl.speed = cfg.minSpeed;
          reason     = "RUN";
        }
      }
      ctrl.lastTs = now;
      return { run: true, speedPct: ctrl.speed, state: ctrl.state, reason };

    case "KICKSTART":
      if (shouldStop) {
        ctrl.state      = "STOPPING";
        ctrl.phaseUntil = now + cfg.stopDelayS * 1000;
        reason          = "STOP";
        ctrl.lastTs     = now;
        return { run: true, speedPct: ctrl.speed, state: ctrl.state, reason };
      }
      if (now >= ctrl.phaseUntil) {
        ctrl.state = "RUNNING";
        reason     = "RUN";
      }
      ctrl.speed  = clamp(cfg.kickstartPct ?? 40, cfg.minSpeed, cfg.maxSpeed);  // hold kickstart speed
      ctrl.lastTs = now;
      return { run: true, speedPct: ctrl.speed, state: ctrl.state, reason };

    case "RUNNING": {
      if (shouldStop) {
        ctrl.state      = "STOPPING";
        ctrl.phaseUntil = now + cfg.stopDelayS * 1000;
        reason          = "STOP";
      }
      const rate = targetSpeed >= ctrl.speed ? cfg.rampUpPctS : cfg.rampDownPctS;
      ctrl.speed  = rampTo(ctrl.speed, targetSpeed, Math.abs(rate) * dtS);
      ctrl.speed  = clamp(ctrl.speed, cfg.minSpeed, cfg.maxSpeed);
      ctrl.lastTs = now;
      return { run: true, speedPct: ctrl.speed, state: ctrl.state, reason };
    }

    case "STOPPING": {
      ctrl.speed  = rampTo(ctrl.speed, 0, Math.abs(cfg.rampDownPctS) * dtS);
      ctrl.lastTs = now;
      const done  = ctrl.speed <= 0.5 && now >= ctrl.phaseUntil;
      if (done) {
        ctrl.state = "OFF";
        ctrl.speed = 0;
        ctrl.iTerm = 0;
        if (antiCycleS > 0) ctrl.antiCycleUntil = now + antiCycleS * 1000;  // NEW
        reason = "OFF";
        return { run: false, speedPct: 0, state: ctrl.state, reason };
      }
      return { run: true, speedPct: Math.max(0, ctrl.speed), state: ctrl.state, reason };
    }
  }

  // fallback
  ctrl.state = "OFF"; ctrl.speed = 0; ctrl.iTerm = 0; ctrl.lastTs = now;
  return { run: false, speedPct: 0, state: ctrl.state, reason: "RESET" };
}

module.exports = { createVspdPumpController, updateVspdPump };