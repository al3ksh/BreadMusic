import { handleLandingDemo } from '@/lib/landing-demo-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handleLandingDemo;
export const GET = handleLandingDemo;
