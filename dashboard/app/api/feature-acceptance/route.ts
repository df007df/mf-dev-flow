import { readFeatureAcceptanceCasesPage } from '../../../server/feature-acceptance-reader.js';
import { workspaceRoot } from '../../../server/workspace.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  try {
    return Response.json(
      readFeatureAcceptanceCasesPage(
        workspaceRoot(),
        new URL(request.url).searchParams,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: String(error instanceof Error ? error.message : error).slice(0, 700) },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
