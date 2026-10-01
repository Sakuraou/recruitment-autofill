import type { ProjectProjectionResponse } from '../profile/projection';
import type { RecordV2Session } from './recordV2Gateway';
import { createProjectRecordSession } from './projectRecordSession';

const FIXTURE_ORIGIN = 'http://localhost:3000';
const FIXTURE_PATH = '/repeatable-records';
const FIXTURE_MARKER = 'record-v2-six-projects-v1';
function urlEligible(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === FIXTURE_ORIGIN && url.pathname === FIXTURE_PATH && url.search === '?case=happy';
  } catch {
    return false;
  }
}

/** This fixture recipe is intentionally unusable on ordinary pages, even in a test build. */
export function isRecordV2FixtureEligible(doc: Document): boolean {
  return urlEligible(doc.URL)
    && doc.documentElement.dataset.raRecordV2Fixture === 'v1'
    && doc.querySelector(`meta[name="ra-record-v2-fixture"][content="${FIXTURE_MARKER}"]`) !== null
    && doc.querySelector(`#ra-record-v2-fixture[data-schema="${FIXTURE_MARKER}"]`) !== null;
}

/** Fixed local recipe remains separate from ordinary-page eligibility. */
export function createRecordV2FixtureSession(doc: Document, projection: ProjectProjectionResponse,
  refreshProjection?: () => Promise<ProjectProjectionResponse>): RecordV2Session {
  if (!isRecordV2FixtureEligible(doc)) throw new Error('当前页面不是通用多记录填写测试页');
  return createProjectRecordSession(doc, projection, refreshProjection, isRecordV2FixtureEligible);
}
