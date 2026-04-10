import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

const BACKEND_DIR = path.resolve(process.cwd(), '..', 'backend');

export async function POST(request: Request) {
  try {
    const { failed_modules } = await request.json().catch(() => ({ failed_modules: [] }));

    if (!failed_modules || failed_modules.length === 0) {
      return NextResponse.json({ success: false, message: 'No failed modules provided' });
    }

    // Simple implementation: trigger specific module scripts or run_all if mapping isn't exact
    const commandsToRun = [];

    for (const m of failed_modules) {
      if (m.includes('risk')) commandsToRun.push('python scripts/build_risk_v1.py');
      else if (m.includes('vr')) commandsToRun.push('python scripts/build_execution_playback.py');
      else if (m.includes('macro')) commandsToRun.push('python scripts/build_macro_snapshot.py');
      else commandsToRun.push('python -X utf8 scripts/run_pipeline_scheduled.py'); // catch all
    }

    // Run unique commands
    const uniqueCmds = Array.from(new Set(commandsToRun));
    for (const cmd of uniqueCmds) {
      exec(cmd, { cwd: BACKEND_DIR }, (error) => {
        if (error) console.error(`Exec retry error: ${error}`);
      });
    }

    return NextResponse.json({ success: true, message: `Retrying ${uniqueCmds.length} scripts.`, triggered: uniqueCmds });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
