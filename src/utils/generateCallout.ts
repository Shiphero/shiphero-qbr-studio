export interface CalloutData {
  stat: string;
  headline: string;
  body?: string;
}

export async function generateCallout(insight: {
  whatHappening: string;
  whyMatters: string;
  action: string;
  actionNote?: string;
}): Promise<CalloutData> {
  const response = await fetch('/api/ai/callout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(insight),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Server error ${response.status}`);
  }

  return response.json() as Promise<CalloutData>;
}
