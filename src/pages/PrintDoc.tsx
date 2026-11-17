import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import DocSheet, { type Company, type FullDoc } from '../components/DocSheet';
import { api } from '../lib/api';
import { TYPE_LABEL } from '../lib/docs';
import { Icon, Spinner, useData } from '../lib/ui';

/** Page d'impression (nouvel onglet) : « Imprimer » → « Enregistrer au format PDF » dans le navigateur. */
export default function PrintDoc() {
  const { id } = useParams();
  const { data, error } = useData(() => Promise.all([api<FullDoc>('/document/' + id), api<Company>('/company')]), [id]);
  useEffect(() => {
    if (!data) return;
    document.title = `${TYPE_LABEL[data[0].type]} ${data[0].number} — ${(data[0].client ?? data[0].supplier)?.name ?? ''}`;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [data]);
  if (error) return <div className="print-page"><div className="err">{error}</div></div>;
  if (!data) return <Spinner />;
  return (
    <div className="print-page">
      <div className="print-bar">
        <button className="btn btn-ghost" onClick={() => window.close()}>Fermer</button>
        <button className="btn btn-green" onClick={() => window.print()}><Icon name="print" size={18} />Imprimer / Enregistrer en PDF</button>
      </div>
      <DocSheet doc={data[0]} co={data[1]} />
    </div>
  );
}
