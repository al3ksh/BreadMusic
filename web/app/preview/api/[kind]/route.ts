import { handleLandingDemo } from '@/lib/landing-demo-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const previewOnly = (request: Request) => process.env.BREAD_LANDING_PREVIEW === '1'
  ? handleLandingDemo(request)
  : new Response(null, { status: 404 });
export const POST = previewOnly;
export const GET = previewOnly;
