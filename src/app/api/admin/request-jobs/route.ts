import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getCurrentAuthSession, isAdminEmail } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { MOVIES_COLLECTION } from '@/lib/server/firestoreNamespaces';
import {
  isRequestFulfillmentJob,
  listRequestFulfillmentJobsForAdmin,
  mapRequestJobDoc,
} from '@/lib/server/adminRequestJobs';
import {
  MOVIE_REQUESTS_COLLECTION,
  REQUEST_PROCESSING_JOBS_COLLECTION,
} from '@/lib/server/movieRequests';
import type { RequestProcessingJob } from '@/types/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getCurrentAuthSession();

  if (!session || (session.role !== 'admin' && !isAdminEmail(session.email))) {
    return null;
  }

  return session;
}

async function resetLinkedRequestAsset(job: RequestProcessingJob, timestamp: string) {
  if (!job.movieId) {
    return;
  }

  const movieRef = adminDb.collection(MOVIES_COLLECTION).doc(job.movieId);
  const basePatch = {
    jobStatus: 'queued',
    currentStage: 'Queued for request VPS final processing',
    processingProgress: 0,
    errorMessage: '',
    updatedAt: timestamp,
  };

  if (job.contentType !== 'series' || !job.seasonNumber || !job.episodeNumber) {
    await movieRef.set(basePatch, { merge: true });
    return;
  }

  const snapshot = await movieRef.get().catch(() => null);
  const data = snapshot?.data() || {};
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];

  const nextSeasons = seasons.map((season) => {
    if (Number(season?.seasonNumber) !== job.seasonNumber) {
      return season;
    }

    const episodes = Array.isArray(season.episodes) ? season.episodes : [];

    return {
      ...season,
      episodes: episodes.map((episode) =>
        Number(episode?.episodeNumber) === job.episodeNumber
          ? {
              ...episode,
              ...basePatch,
            }
          : episode
      ),
    };
  });

  await movieRef.set(
    {
      ...basePatch,
      ...(nextSeasons.length ? { seasons: nextSeasons } : {}),
    },
    { merge: true }
  );
}

function getRequestJobId(body: Record<string, unknown>) {
  return String(body.id || body.jobId || '').trim();
}

function getRequestJobAction(body: Record<string, unknown>) {
  const action = String(body.action || '').trim().toLowerCase();
  return action === 'retry' || action === 'delete' ? action : '';
}

export async function GET() {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const jobs = await listRequestFulfillmentJobsForAdmin(500);

    return NextResponse.json({ jobs, limit: 500 });
  } catch (error) {
    console.error('[admin-request-jobs] failed to list request jobs', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load request processing jobs.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();

    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = getRequestJobId(body);
    const action = getRequestJobAction(body);

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing request job action.' }, { status: 400 });
    }

    const jobRef = adminDb.collection(REQUEST_PROCESSING_JOBS_COLLECTION).doc(id);
    const snapshot = await jobRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Request job not found.' }, { status: 404 });
    }

    const job = mapRequestJobDoc({ id: snapshot.id, data: () => snapshot.data() || {} });

    if (!isRequestFulfillmentJob(job)) {
      return NextResponse.json({ error: 'This is not a request fulfillment job.' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const requestRef = job.requestId ? adminDb.collection(MOVIE_REQUESTS_COLLECTION).doc(job.requestId) : null;

    if (action === 'delete') {
      await jobRef.delete();

      if (requestRef) {
        await requestRef.set(
          {
            status: 'pending',
            processingJobId: '',
            workerStatus: 'deleted',
            workerError: '',
            progress: 0,
            currentStage: 'Removed from request processing queue',
            updatedAt: timestamp,
            lastActionAt: timestamp,
          },
          { merge: true }
        );
      }

      return NextResponse.json({ ok: true, deleted: true });
    }

    await jobRef.set(
      {
        status: 'queued',
        progress: 0,
        workerId: '',
        workerHeartbeatAt: null,
        startedAt: null,
        completedAt: null,
        errorMessage: '',
        currentStage: 'Queued for request VPS final processing',
        queuedAt: timestamp,
        updatedAt: timestamp,
        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await resetLinkedRequestAsset(job, timestamp);

    if (requestRef) {
      await requestRef.set(
        {
          status: 'processing',
          processingJobId: job.id,
          workerStatus: 'queued',
          workerError: '',
          progress: 0,
          currentStage: 'Queued for request VPS final processing',
          updatedAt: timestamp,
          lastActionAt: timestamp,
        },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true, retried: true });
  } catch (error) {
    console.error('[admin-request-jobs] failed to update request job', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update request processing job.',
      },
      { status: 500 }
    );
  }
}
