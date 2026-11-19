export async function startKhaltiCheckout(plan, accessToken) {
  const response = await fetch('/api/payments/khalti/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ plan })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not start checkout.');
  return data;
}

export async function verifyKhaltiCheckout(pidx, accessToken) {
  const response = await fetch('/api/payments/khalti/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ pidx })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Payment verification failed.');
  return data;
}
