import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

const BACKEND_DIR = path.resolve(process.cwd(), '..', 'backend');

export async function POST(request: Request) {
  try {
    const { step } = await request.json().catch(() => ({ step: 'full' }));

    let command = 'python -X utf8 scripts/run_pipeline_scheduled.py';
    
    if (step === 'risk') {
      command = 'python scripts/build_risk_v1.py';
    } else if (step === 'vr') {
      command = 'python scripts/build_execution_playback.py'; // Note: Or tsx? using user spec verbatim "python backend/scripts/build_execution_playback.py"
    } else if (step === 'macro') {
      command = 'python scripts/build_macro_snapshot.py';
    }

    // Trigger detached to not block response
    exec(command, { cwd: BACKEND_DIR }, (error, stdout, stderr) => {
      if (error) console.error(`Exec error: ${error}`);
    });

    return NextResponse.json({ success: true, message: `Pipeline step '${step}' started.`, command });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
