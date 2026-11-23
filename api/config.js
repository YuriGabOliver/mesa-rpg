// Entrega ao navegador só o que é público: endereço do Supabase e a chave pública (para o Realtime).
import { URL_, CHAVE_PUBLICA } from './_db.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_()) return res.status(500).json({ erro: 'Supabase não configurado (veja o README).' });
  return res.status(200).json({ url: URL_(), anon: CHAVE_PUBLICA() || null });
}
