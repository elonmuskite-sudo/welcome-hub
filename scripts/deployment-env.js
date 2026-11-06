export function isProductionDeployment(env = process.env) {
  return env.VERCEL_ENV === 'production'
    || (!env.VERCEL_ENV && env.NODE_ENV === 'production')
}
