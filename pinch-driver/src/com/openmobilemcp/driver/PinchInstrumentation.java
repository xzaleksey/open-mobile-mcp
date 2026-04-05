package com.openmobilemcp.driver;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;

public class PinchInstrumentation extends Instrumentation {

    private Bundle args;

    @Override
    public void onCreate(Bundle arguments) {
        this.args = arguments != null ? arguments : new Bundle();
        start();
    }

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
            String action = args.getString("action", "pinch");
            switch (action) {
                case "pinch":    doPinch(result);    break;
                case "rotate":   doRotate(result);   break;
                case "clipboard_get": doClipboardGet(result); break;
                default:
                    result.putString("error", "Unknown action: " + action);
                    finish(1, result);
                    return;
            }
        } catch (Exception e) {
            result.putString("error", e.getMessage());
            finish(1, result);
        }
    }

    // ── Pinch gesture ────────────────────────────────────────────────────────

    private void doPinch(Bundle result) throws Exception {
        float cx       = Float.parseFloat(args.getString("centerX", "540"));
        float cy       = Float.parseFloat(args.getString("centerY", "600"));
        boolean zoomIn = "out".equals(args.getString("direction", "out"));
        float spread   = Float.parseFloat(args.getString("spread", "200"));
        long duration  = Long.parseLong(args.getString("duration", "500"));
        int steps      = 20;

        float near = spread * 0.15f;
        float far  = spread;

        float x1Start = zoomIn ? cx - near : cx - far;
        float x1End   = zoomIn ? cx - far  : cx - near;
        float x2Start = zoomIn ? cx + near  : cx + far;
        float x2End   = zoomIn ? cx + far   : cx + near;

        UiAutomation uia = getUiAutomation();
        injectTwoFingerGesture(uia,
            x1Start, cy, x1End, cy,
            x2Start, cy, x2End, cy,
            steps, duration);

        result.putString("result", "ok");
        finish(0, result);
    }

    // ── Rotate gesture ───────────────────────────────────────────────────────

    private void doRotate(Bundle result) throws Exception {
        float cx      = Float.parseFloat(args.getString("centerX", "540"));
        float cy      = Float.parseFloat(args.getString("centerY", "600"));
        float radius  = Float.parseFloat(args.getString("radius", "120"));
        float degrees = Float.parseFloat(args.getString("degrees", "45"));
        long duration = Long.parseLong(args.getString("duration", "500"));
        int steps     = 20;

        // Finger 0 starts at angle 0° (right), finger 1 at 180° (left)
        double startRad = 0;
        double totalRad = Math.toRadians(degrees);

        float x1Start = (float)(cx + radius * Math.cos(startRad));
        float y1Start = (float)(cy + radius * Math.sin(startRad));
        float x2Start = (float)(cx + radius * Math.cos(startRad + Math.PI));
        float y2Start = (float)(cy + radius * Math.sin(startRad + Math.PI));

        double endRad = startRad + totalRad;
        float x1End   = (float)(cx + radius * Math.cos(endRad));
        float y1End   = (float)(cy + radius * Math.sin(endRad));
        float x2End   = (float)(cx + radius * Math.cos(endRad + Math.PI));
        float y2End   = (float)(cy + radius * Math.sin(endRad + Math.PI));

        UiAutomation uia = getUiAutomation();

        // Use arc interpolation rather than linear for rotation
        MotionEvent.PointerProperties[] pp = makePointerProps();
        MotionEvent.PointerCoords[] pc = makePointerCoords();
        long downTime = SystemClock.uptimeMillis();
        long stepDelay = duration / steps;

        // Fingers down
        pc[0].x = x1Start; pc[0].y = y1Start;
        pc[1].x = x2Start; pc[1].y = y2Start;
        inject(uia, downTime, MotionEvent.ACTION_DOWN, 1, pp, pc);
        inject(uia, downTime, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, pp, pc);

        // Arc move
        for (int i = 1; i <= steps; i++) {
            double angle = startRad + totalRad * i / steps;
            pc[0].x = (float)(cx + radius * Math.cos(angle));
            pc[0].y = (float)(cy + radius * Math.sin(angle));
            pc[1].x = (float)(cx + radius * Math.cos(angle + Math.PI));
            pc[1].y = (float)(cy + radius * Math.sin(angle + Math.PI));
            inject(uia, downTime, MotionEvent.ACTION_MOVE, 2, pp, pc);
            Thread.sleep(stepDelay);
        }

        // Fingers up
        inject(uia, downTime, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, pp, pc);
        pc[0].x = x1End; pc[0].y = y1End;
        inject(uia, downTime, MotionEvent.ACTION_UP, 1, pp, pc);

        result.putString("result", "ok");
        finish(0, result);
    }

    // ── Clipboard read ───────────────────────────────────────────────────────

    private void doClipboardGet(Bundle result) {
        Context ctx = getTargetContext();
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        String text = "";
        if (cm != null && cm.hasPrimaryClip()) {
            ClipData data = cm.getPrimaryClip();
            if (data != null && data.getItemCount() > 0) {
                CharSequence cs = data.getItemAt(0).coerceToText(ctx);
                if (cs != null) text = cs.toString();
            }
        }
        result.putString("text", text);
        finish(0, result);
    }

    // ── Shared helpers ───────────────────────────────────────────────────────

    private void injectTwoFingerGesture(
            UiAutomation uia,
            float x1s, float y1s, float x1e, float y1e,
            float x2s, float y2s, float x2e, float y2e,
            int steps, long duration) throws InterruptedException {

        MotionEvent.PointerProperties[] pp = makePointerProps();
        MotionEvent.PointerCoords[] pc = makePointerCoords();
        long downTime = SystemClock.uptimeMillis();
        long stepDelay = duration / steps;

        pc[0].x = x1s; pc[0].y = y1s;
        pc[1].x = x2s; pc[1].y = y2s;
        inject(uia, downTime, MotionEvent.ACTION_DOWN, 1, pp, pc);
        inject(uia, downTime, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, pp, pc);

        for (int i = 1; i <= steps; i++) {
            float t = (float) i / steps;
            pc[0].x = x1s + (x1e - x1s) * t; pc[0].y = y1s + (y1e - y1s) * t;
            pc[1].x = x2s + (x2e - x2s) * t; pc[1].y = y2s + (y2e - y2s) * t;
            inject(uia, downTime, MotionEvent.ACTION_MOVE, 2, pp, pc);
            Thread.sleep(stepDelay);
        }

        inject(uia, downTime, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, pp, pc);
        pc[0].x = x1e; pc[0].y = y1e;
        inject(uia, downTime, MotionEvent.ACTION_UP, 1, pp, pc);
    }

    private void inject(UiAutomation uia, long downTime, int action,
                        int pointerCount,
                        MotionEvent.PointerProperties[] pp,
                        MotionEvent.PointerCoords[] pc) {
        MotionEvent ev = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(),
            action, pointerCount, pp, pc, 0, 0, 1, 1, 0, 0,
            0x1002 /* InputDevice.SOURCE_TOUCHSCREEN */, 0);
        uia.injectInputEvent(ev, true);
        ev.recycle();
    }

    private MotionEvent.PointerProperties[] makePointerProps() {
        MotionEvent.PointerProperties[] pp = new MotionEvent.PointerProperties[2];
        pp[0] = new MotionEvent.PointerProperties(); pp[0].id = 0; pp[0].toolType = MotionEvent.TOOL_TYPE_FINGER;
        pp[1] = new MotionEvent.PointerProperties(); pp[1].id = 1; pp[1].toolType = MotionEvent.TOOL_TYPE_FINGER;
        return pp;
    }

    private MotionEvent.PointerCoords[] makePointerCoords() {
        MotionEvent.PointerCoords[] pc = new MotionEvent.PointerCoords[2];
        pc[0] = new MotionEvent.PointerCoords(); pc[0].pressure = 1.0f; pc[0].size = 1.0f;
        pc[1] = new MotionEvent.PointerCoords(); pc[1].pressure = 1.0f; pc[1].size = 1.0f;
        return pc;
    }
}
