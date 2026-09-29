declare const __RA_RECORD_V2_TEST_BUILD__: boolean | undefined;

/** Shipping default is false. The build script only enables this for the isolated fixture build. */
export const REPEATABLE_RECORD_V2_ENABLED = typeof __RA_RECORD_V2_TEST_BUILD__ !== 'undefined'
  && __RA_RECORD_V2_TEST_BUILD__ === true;
