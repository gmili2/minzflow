import { useEffect, useRef, useState } from 'react';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon, PageHead } from '../lib/ui';

const SUGG = ['Quel est mon chiffre d’affaires ce mois-ci ?', 'Quelles factures sont impayées ?', 'Qui sont mes meilleurs clients ?', 'Quels articles réapprovisionner ?', 'Quelle est ma trésorerie ?', 'Combien de TVA dois-je ce mois-ci ?', 'Quel est mon bénéfice ?', 'Où en sont mes devis ?'];

export default function Assistant() {
  const { me } = useAuth();
  const [chat, setChat] = useState<{ from: 'ai' | 'me'; text: string }[]>([{ from: 'ai', text: `Bonjour ${me?.name.split(' ')[0]} ! Je suis l'assistant MizanFlow. Demandez-moi votre chiffre d'affaires, les factures impayées, vos meilleurs clients, l'état du stock, la trésorerie ou la TVA.` }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [chat]);

  const ask = async (q: string) => {
    const t = q.trim();
    if (!t || busy) return;
    setInput(''); setBusy(true);
    setChat((c) => [...c, { from: 'me', text: t }, { from: 'ai', text: '…' }]);
    try {
      const r = await post<{ answer: string }>('/assistant', { question: t });
      setChat((c) => [...c.slice(0, -1), { from: 'ai', text: r.answer }]);
    } catch (e) { setChat((c) => [...c.slice(0, -1), { from: 'ai', text: (e as Error).message }]); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Assistant IA" sub="Posez vos questions sur votre activité : les réponses sont calculées sur vos données en temps réel." />
      <section className="card" style={{ maxWidth: 900 }}>
        <div className="chat" aria-live="polite">
          {chat.map((m, i) => <div key={i} className={'msg ' + m.from}>{m.text}</div>)}
          <div ref={end} />
        </div>
        <div className="chips" style={{ margin: '14px 0' }}>{SUGG.map((s) => <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
        <form style={{ display: 'flex', gap: 10 }} onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input className="inp" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Votre question…" aria-label="Votre question" maxLength={500} />
          <button className="btn btn-green" disabled={busy || !input.trim()}><Icon name="send" size={18} />Envoyer</button>
        </form>
      </section>
    </>
  );
}
