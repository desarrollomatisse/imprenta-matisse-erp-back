/** Los seeds crean cuentas con clave conocida: exigen permiso explícito. */
export function assertTestSeedAllowed(): void {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ALLOW_TEST_SEED !== 'true'
  ) {
    throw new Error(
      'Los seeds de prueba solo corren en desarrollo con ALLOW_TEST_SEED=true.',
    );
  }
}
