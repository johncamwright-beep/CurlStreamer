import "server-only";
export function labEnabled(env = process.env) {
  return (
    env.CURLCOACH_ENABLED === "true" &&
    env.CURLCOACH_LOCAL_LAB === "true" &&
    env.NODE_ENV !== "production" &&
    (env.CURLCOACH_LAB_SECRET?.length ?? 0) >= 32
  );
}
