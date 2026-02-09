import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';

import type { AppConfig } from './config.js';
import type { PickupService } from './midnight/pickup.js';
import type { JobStore } from './jobs.js';

const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'expected 32-byte hex string');

const rxIdSchema = z.union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()]);

export const buildServer = async (params: { config: AppConfig; pickup: PickupService; jobs: JobStore }) => {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    global: true,
    // This service is meant for local demo usage, but still protect endpoints that touch disk and/or
    // submit transactions (satisfies CodeQL's missing-rate-limiting rule).
    max: 600,
    timeWindow: '1 minute',
  });

  app.get(
    '/api/health',
    {
      preHandler: app.rateLimit({ max: 60, timeWindow: '1 minute' }),
    },
    async () => {
      const status = await params.pickup.getStatus();
      return { ok: true, network: params.config.network, ...status };
    },
  );

  app.post('/api/clinic/init', async () => {
    return await params.pickup.initClinic();
  });

  app.post('/api/patient', async () => {
    return await params.pickup.createPatient();
  });

  app.post(
    '/api/contract/deploy',
    {
      preHandler: app.rateLimit({ max: 2, timeWindow: '1 minute' }),
    },
    async () => {
      return await params.pickup.deployContract();
    },
  );

  app.post('/api/jobs/deploy', async () => {
    const job = params.jobs.create('deployContract', async (log) => {
      log('Starting contract deployment (may take a long time on local proof-server)...');
      const out = await params.pickup.deployContract();
      log(`Deployed at ${out.contractAddress}`);
      return out;
    });
    return { jobId: job.id };
  });

  app.post('/api/jobs/register', async (req) => {
    const body = z
      .object({
        rxId: rxIdSchema,
        pharmacyIdHex: hex32,
        patientId: z.string().uuid().optional(),
        patientPublicKeyHex: hex32.optional(),
      })
      .refine((v) => v.patientId != null || v.patientPublicKeyHex != null, {
        message: 'patientId or patientPublicKeyHex required',
        path: ['patientId'],
      })
      .parse(req.body);

    const job = params.jobs.create('registerAuthorization', async (log) => {
      log('Submitting clinic registerAuthorization tx...');
      const out = await params.pickup.registerAuthorization(body);
      log(`Submitted tx ${out.txId} at block ${out.blockHeight}`);
      return out;
    });
    return { jobId: job.id };
  });

  app.post('/api/jobs/redeem', async (req) => {
    const body = z
      .object({
        patientId: z.string().uuid(),
        rxId: rxIdSchema,
        pharmacyIdHex: hex32,
      })
      .parse(req.body);

    const job = params.jobs.create('redeem', async (log) => {
      log('Submitting patient redeem tx...');
      const out = await params.pickup.redeem(body);
      log(`Submitted tx ${out.txId} at block ${out.blockHeight}`);
      return out;
    });
    return { jobId: job.id };
  });

  app.get('/api/jobs/:jobId', async (req) => {
    const jobId = z.object({ jobId: z.string().uuid() }).parse((req as any).params).jobId;
    const job = params.jobs.get(jobId);
    if (!job) return { job: null };
    return { job };
  });

  app.post('/api/contract/join', async (req) => {
    const body = z.object({ contractAddress: z.string().min(1) }).parse(req.body);
    return await params.pickup.setContractAddress(body.contractAddress);
  });

  app.get(
    '/api/contract/state',
    {
      preHandler: app.rateLimit({ max: 120, timeWindow: '1 minute' }),
    },
    async () => {
      const ledgerState = await params.pickup.getLedgerStateJson();
      return { ledgerState };
    },
  );

  app.post(
    '/api/clinic/register',
    {
      preHandler: app.rateLimit({ max: 10, timeWindow: '1 minute' }),
    },
    async (req) => {
      const body = z
        .object({
          rxId: rxIdSchema,
          pharmacyIdHex: hex32,
          patientId: z.string().uuid().optional(),
          patientPublicKeyHex: hex32.optional(),
        })
        .refine((v) => v.patientId != null || v.patientPublicKeyHex != null, {
          message: 'patientId or patientPublicKeyHex required',
          path: ['patientId'],
        })
        .parse(req.body);

      return await params.pickup.registerAuthorization(body);
    },
  );

  app.post('/api/patient/redeem', async (req) => {
    const body = z
      .object({
        patientId: z.string().uuid(),
        rxId: rxIdSchema,
        pharmacyIdHex: hex32,
      })
      .parse(req.body);
    return await params.pickup.redeem(body);
  });

  app.post('/api/pharmacy/check', async (req) => {
    const body = z
      .object({
        patientId: z.string().uuid(),
        rxId: rxIdSchema,
        pharmacyIdHex: hex32,
      })
      .parse(req.body);
    return await params.pickup.check(body);
  });

  return app;
};
