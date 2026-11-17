import type { Env } from './types';

export interface CompanyInfo {
  inn: string;
  kpp: string | null;
  name: string;
  address: string | null;
  ogrn: string | null;
}

export async function lookupByInn(env: Env, rawInn: string): Promise<CompanyInfo | null> {
  const inn = rawInn.replace(/\D/g, '');
  if (!inn || (inn.length !== 10 && inn.length !== 12) || !env.DADATA_API_KEY) return null;
  try {
    const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Token ${env.DADATA_API_KEY}`,
      },
      body: JSON.stringify({ query: inn, count: 1 }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const s = j?.suggestions?.[0];
    if (!s) return null;
    return {
      inn,
      kpp: s.data?.kpp ?? null,
      name: s.value ?? s.data?.name?.short_with_opf ?? `ИНН ${inn}`,
      address: s.data?.address?.unrestricted_value ?? s.data?.address?.value ?? null,
      ogrn: s.data?.ogrn ?? null,
    };
  } catch (e) {
    console.warn('dadata error', e);
    return null;
  }
}
