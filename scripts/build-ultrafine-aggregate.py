import csv, hashlib, json, re, unicodedata
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'workgeo-crm/deliverables/prospecting-cnpj-2026-10'
OUT=BASE/'ultrafine'; LEADS=BASE/'leads-potential-3-regions-2026-10.csv'; DATE='2026-10-30'
AGENTS=[('batch-100-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-01'),('batch-100-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-01'),('batch-100-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-01'),('batch-200-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-02'),('batch-200-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-02'),('batch-200-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-02'),('batch-300-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-03'),('batch-300-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-03'),('batch-300-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-03'),('batch-400-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-04'),('batch-400-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-04'),('batch-400-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-04'),('batch-500-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-05'),('batch-500-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-05'),('batch-500-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-05'),('batch-600-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-06'),('batch-600-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-06'),('batch-600-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-06'),('batch-700-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-07'),('batch-700-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-07'),('batch-700-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-07'),('batch-800-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-08'),('batch-800-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-08'),('batch-800-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-08'),('batch-900-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-09'),('batch-900-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-09'),('batch-900-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-09'),('batch-1000-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-10'),('batch-1000-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-10'),('batch-1000-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-10'),('batch-1100-belo-horizonte.json','belo-horizonte-170km','Belo Horizonte (170 km)','LOTE-100-11'),('batch-1100-volta-redonda.json','volta-redonda-100km','Volta Redonda (100 km)','LOTE-100-11'),('batch-1100-campinas.json','campinas-250km','Campinas (250 km)','LOTE-100-11')]
REGIONS=[('belo-horizonte-170km','Belo Horizonte (170 km)'),('volta-redonda-100km','Volta Redonda (100 km)'),('campinas-250km','Campinas (250 km)')]
EXTRA=['research_region_id','research_region_name','research_batch','research_status','status_reason','operational_evidence','materials_or_stock','size_assessment','public_contact_assessment','public_channel_usable','address_assessment','operational_address_confirmed','latitude_confirmed','longitude_confirmed','coordinate_reference_latitude','coordinate_reference_longitude','coordinate_scope','distance_km_confirmed','distance_reference_km_not_validated','within_radius_confirmed','research_name_reference','company_name_match_status','research_sources','research_date','research_notes']
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''): h.update(b)
 return h.hexdigest()
def valid(v):
 d=re.sub(r'\D','',v or '')
 if len(d)!=14 or len(set(d))==1:return False
 for i,w in [(12,[5,4,3,2,9,8,7,6,5,4,3,2]),(13,[6,5,4,3,2,9,8,7,6,5,4,3,2])]:
  n=sum(int(d[j])*w[j] for j in range(i))%11
  if int(d[i])!=(0 if n<2 else 11-n):return False
 return True
def norm(s):
 return re.sub(r'[^A-Z0-9]','',unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().upper())
def can_select(r):
 return str(r.get('within_radius_confirmed','')).lower()=='true' and bool(r.get('latitude_confirmed')) and bool(r.get('longitude_confirmed')) and str(r.get('public_channel_usable','')).lower()=='true'
OUT.mkdir(parents=True,exist_ok=True)
with LEADS.open(encoding='utf-8-sig',newline='') as f: src=list(csv.DictReader(f,delimiter=';'))
by={r['cnpj']:r for r in src}
if len(by)!=len(src):raise ValueError('CNPJ repetido na base')
fields=list(src[0])+EXTRA; rows=[]
for path in [OUT/'leads-ultrafine-selected-pilot-2026-10.csv',OUT/'leads-ultrafine-pending-pilot-2026-10.csv']:
 with path.open(encoding='utf-8-sig',newline='') as f:
  for old in csv.DictReader(f,delimiter=';'):
   r=dict(old); r.update(research_region_id=old.get('pilot_region_id',''),research_region_name=old.get('pilot_region_name',''),research_batch='PILOTO-30',operational_address_confirmed=old.get('operational_address','NÃO CONFIRMADO'),latitude_confirmed='',longitude_confirmed='',coordinate_reference_latitude=old.get('suggested_latitude',''),coordinate_reference_longitude=old.get('suggested_longitude',''),coordinate_scope='Sugestão CNEFE; não confirma operação',distance_km_confirmed='',distance_reference_km_not_validated=old.get('suggested_distance_km_not_validated',''),within_radius_confirmed='false',public_channel_usable='false',research_date=old.get('research_date',DATE)); rows.append(r)
for fn,rid,rname,batch_name in AGENTS:
 data=json.loads((OUT/fn).read_text(encoding='utf-8'))
 for x in data:
  cnpj=re.sub(r'\D','',x.get('cnpj',''))
  if cnpj not in by or not valid(cnpj):raise ValueError(f'CNPJ ausente/inválido {cnpj}')
  raw_region=x.get('region',rid)
  if raw_region not in (rid,rname,'Campinas','Belo Horizonte','Volta Redonda') or rid not in json.loads(by[cnpj]['eligible_region_ids']):raise ValueError(f'Região divergente {cnpj}: {raw_region}')
  coord=(x.get('latitude') is not None and x.get('longitude') is not None and x.get('within_radius_confirmed') is True and 'watercourse' not in x.get('coordinate_scope','').lower() and "curso d'água" not in x.get('coordinate_scope','').lower())
  raw_status=x.get('status','').lower()
  status='SELECIONADA' if raw_status in ('selected','selecionada','selecionado') else ('FORA_DO_PERFIL' if raw_status in ('out','outside','fora','fora_do_perfil') else 'PENDENTE')
  name=x.get('company_name',''); r=dict(by[cnpj]); r.update(research_region_id=rid,research_region_name=rname,research_batch=batch_name,research_status=status,status_reason=x.get('notes',''),operational_evidence=x.get('evidence',''),materials_or_stock=x.get('materials_or_stock',''),size_assessment=x.get('size_assessment',''),public_contact_assessment=x.get('public_contact_assessment',''),public_channel_usable='true' if x.get('public_channel_usable') is True else 'false',address_assessment=x.get('address_assessment',''),operational_address_confirmed=x.get('operational_address_confirmed','') if coord else 'NÃO CONFIRMADO',latitude_confirmed=x.get('latitude','') if coord else '',longitude_confirmed=x.get('longitude','') if coord else '',coordinate_reference_latitude=x.get('latitude',''),coordinate_reference_longitude=x.get('longitude',''),coordinate_scope=x.get('coordinate_scope','') or ('Fonte oficial da unidade' if coord else 'Ponto operacional individual não confirmado'),distance_km_confirmed=x.get('distance_km','') if coord else '',distance_reference_km_not_validated=by[cnpj].get('distance_to_eligible_region_km',''),within_radius_confirmed='true' if coord else 'false',research_name_reference=(name if name else 'Não informado na ficha; identidade pelo CNPJ da base'),company_name_match_status=('NOME NÃO INFORMADO NA FICHA; CNPJ-BASE CONFERIDO' if not name else ('CORRESPONDENTE' if norm(by[cnpj]['company_name'])==norm(name) else 'VARIANTE; VALIDAR PELO CNPJ')),research_sources=' | '.join(x.get('source_urls',[])),research_date=DATE,research_notes=x.get('notes','')+' Fonte cadastral: CSV RFB 2026-10. Pesquisa pública 2026-10-30; sem contato direto.')
  if status=='SELECIONADA' and not can_select(r):r['research_status']='PENDENTE';r['status_reason']+=' Reclassificada: faltou comprovar ponto operacional e/ou canal público utilizável.'
  rows.append(r)
batch_counts=Counter(r.get('research_batch') for r in rows)
if any(batch_counts[f'LOTE-100-{n:02d}']!=100 for n in (1,2,3,4,5,6,7,8,9,10,11)):raise ValueError(f'Lotes incompletos: {batch_counts}')
present={(r['cnpj'],r.get('research_region_id')) for r in rows}; supplemental=[]
for source in list(rows):
 eligible=json.loads(source.get('eligible_region_ids') or '[]')
 for rid in eligible:
  if (source['cnpj'],rid) in present:continue
  region_name=next((name for region_id,name in REGIONS if region_id==rid),rid)
  clone=dict(source); clone.update(research_region_id=rid,research_region_name=region_name,research_batch='SOBREPOSICAO-REGIONAL',research_status='PENDENTE',status_reason=f'Vínculo regional suplementar: a base de candidatos associa este CNPJ também a {region_name}. A elegibilidade municipal não prova que o ponto operacional esteja dentro deste raio; confirmação específica desta região pendente.',operational_evidence=(source.get('operational_evidence','')+' Evidência reutilizada somente para identidade/atividade da unidade; não comprova localização neste recorte.'),address_assessment=(source.get('address_assessment','')+f' Sem ponto operacional confirmado especificamente para {region_name}.'),operational_address_confirmed='NÃO CONFIRMADO para esta região',latitude_confirmed='',longitude_confirmed='',coordinate_reference_latitude='',coordinate_reference_longitude='',coordinate_scope='Ponto operacional individual não confirmado neste recorte; eventual CNEFE é somente sugestão',distance_km_confirmed='',distance_reference_km_not_validated='',within_radius_confirmed='false',research_notes=source.get('research_notes','')+f' Vínculo suplementar derivado de eligible_region_ids da base; sem geocodificação regional adicional.')
  supplemental.append(clone); present.add((source['cnpj'],rid))
if supplemental:
 (OUT/'regional-overlap-pending.json').write_text(json.dumps(supplemental,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 rows.extend(supplemental)
region_pairs=[(r['cnpj'],r.get('research_region_id')) for r in rows]
if len(region_pairs)!=len(set(region_pairs)):raise ValueError('CNPJ/unidade repetido na mesma região entre arquivos')
for r in rows:
 if not valid(r['cnpj']):raise ValueError('CNPJ inválido no resultado '+r['cnpj'])
selected=[r for r in rows if r.get('research_status')=='SELECIONADA' and can_select(r)]; pending=[r for r in rows if r not in selected]
paths={'selected':OUT/'leads-ultrafine-selected-2026-10.csv','pending':OUT/'leads-ultrafine-pending-2026-10.csv'}
for k,arr in [('selected',selected),('pending',pending)]:
 with paths[k].open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields,delimiter=';',extrasaction='ignore');w.writeheader();w.writerows(arr)
region_counts={}
for rid,name in REGIONS:
 a=[r for r in rows if r.get('research_region_id')==rid];region_counts[name]={'linhas':len(a),'selecionadas':sum(r['research_status']=='SELECIONADA' for r in a),'pendentes':sum(r['research_status']=='PENDENTE' for r in a),'fora_do_perfil':sum(r['research_status']=='FORA_DO_PERFIL' for r in a),'fora_do_raio_provisorio':sum(r['research_status']=='FORA_DO_RAIO_PROVISÓRIO' for r in a)}
summary={'created_on':DATE,'scope_status':'SUPERSEDED_RESTRICTED_SUBSET_NOT_FINAL','scope_correction':'Lotes selecionados do CSV de 23.519 Leads, pré-filtrado para ME/EPP e sugestão CNEFE dentro dos raios; não representam a peneira ampla de 1.062.956 CNPJs. Preservar como subset histórico.','prior_source_csv':'leads-potential-3-regions-2026-10.csv','prior_source_rows':23519,'broad_source_csv':'prospecting-cnpj-2026-10.csv','broad_source_rows':1062956,'pilot_assignments':sum(r.get('research_batch')=='PILOTO-30' for r in rows),'batch_100_candidates':sum(r.get('research_batch','').startswith('LOTE-100-') for r in rows),'completed_100_candidate_batches':11,'supplemental_region_assignments':len(supplemental),'total_region_assignments':len(rows),'unique_establishments':len({r['cnpj'] for r in rows}),'unique_cnpj_bases':len({r['cnpj_base'] for r in rows}),'selected':len(selected),'pending_csv_rows':len(pending),'pending_review':sum(r.get('research_status')=='PENDENTE' for r in rows),'outside_profile':sum(r.get('research_status')=='FORA_DO_PERFIL' for r in rows),'outside_radius_provisional':sum(r.get('research_status')=='FORA_DO_RAIO_PROVISÓRIO' for r in rows),'region_counts':region_counts,'files':{k:{'file':p.name,'rows':len(selected if k=='selected' else pending),'bytes':p.stat().st_size,'sha256':sha(p)} for k,p in paths.items()},'batch_json_sha256':{fn:sha(OUT/fn) for fn,_,_,_ in AGENTS},'regional_overlap_json_sha256':sha(OUT/'regional-overlap-pending.json') if supplemental else None}
(OUT/'ultrafine-metadata-2026-10.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
table='\n'.join(f"| {n} | {d['linhas']} | {d['selecionadas']} | {d['pendentes']} | {d['fora_do_perfil']} | {d['fora_do_raio_provisorio']} |" for n,d in region_counts.items())
selected_details='\n'.join(f"- **{r['company_name']} — CNPJ {r['cnpj']} ({r['research_region_name']}).** {r.get('operational_evidence','')} Local: {r.get('operational_address_confirmed','')}; {r.get('distance_km_confirmed','')} km do centro. Canal: {r.get('public_contact_assessment','')}" for r in selected)
report=f'''# Peneira ultrafina WorkGeo — versão parcial restrita, não final

**Data de corte:** {DATE}. Pesquisa para CSV local; nenhuma alteração/importação no CRM, Turso ou site.

> **Correção de escopo (30/10/2026):** os lotes abaixo foram selecionados a partir do CSV de 23.519 potenciais Leads, já limitado a ME/EPP e a unidades com sugestão CNEFE dentro dos raios. O escopo aprovado parte dos 1.062.956 CNPJs segmentados e não permite excluir previamente empresas grandes/desconhecidas nem endereços sem sugestão. Estes arquivos são um subconjunto exploratório, não a peneira final; a seleção seguinte será refeita a partir da base ampla. Nenhum registro foi importado no CRM.

## Resultado

Pesquisados {summary['pilot_assignments']} vínculos no piloto e {summary['batch_100_candidates']} candidatos nos onze primeiros lotes de 100. Foram adicionados {summary['supplemental_region_assignments']} vínculos suplementares nas outras regiões elegíveis declaradas pela base, sem presumir que a unidade esteja dentro desses raios: {len(rows)} linhas candidato-região, {summary['unique_establishments']} CNPJs de estabelecimento e {summary['unique_cnpj_bases']} CNPJs-base.

- Selecionadas: {len(selected)}.
- Pendentes de investigação: {summary['pending_review']}.
- Fora do perfil: {summary['outside_profile']}.
- Fora provisoriamente do raio: {summary['outside_radius_provisional']}.
- O CSV de pendências/revisão reúne os {len(pending)} registros não selecionados, mantendo essas três situações separadas na coluna `research_status`.
- A seleção exige perfil muito provável, unidade operacional individual dentro do raio e canal público utilizável.

### Selecionadas

{selected_details}

| Região | Linhas | Selecionadas | Pendentes | Fora do perfil | Fora provisoriamente do raio |
|---|---:|---:|---:|---:|---:|
{table}

## Método e limites

A origem é o CSV local de potenciais Leads, derivado do snapshot RFB 2026-10. As referências dos recortes (BH 170 km, VR 100 km, Campinas 250 km) e a distância Haversine estão em `workgeo-crm/data/prospecting-regions/regions.json`; o centro BH é provisório. Município que cruza um raio e distância CNEFE sugerida não confirmam a unidade no círculo.

A estrutura de campos usa como referência o cadastro das 27 unidades em `workgeo-crm/deliverables/WorkGeo_CRM_Transicao.xlsx`: empresa/unidade, segmento, materiais, porte com evidência e fonte, município, coordenadas/mapa, distância, origem e data. O CSV mantém esses elementos quando disponíveis e acrescenta CNPJ, atividade/estoque, confirmação de endereço operacional, canal público e evidência/fonte individual. As distâncias da peneira são em linha reta pelo método Haversine; não são as distâncias rodoviárias da planilha original.

Cada ficha preserva CNPJ de estabelecimento, CNPJ-base, unidade, região, CNAE/segmento, porte cadastral, endereço e contato de origem. Evidência operacional, material/estoque, porte operacional, canal, endereço operacional, coordenada, distância e fontes têm campos próprios. Capital social não representa porte operacional. Licenças provam o escopo/prazo do ato, não operação contínua. Endereço residencial/CASA é sinal para validação, não exclusão automática. Fontes públicas consultadas em 2026-10-30; sem contato às empresas e sem fontes pagas. A pesquisa não confirma demanda nem intenção de compra.

CNPJ e dígitos verificadores, correspondência à base e região elegível foram conferidos. Se um CNPJ foi pesquisado em uma região e a base o associa também a outra, o CSV acrescenta uma linha suplementar pendente para essa região; coordenada, distância e operação não são transferidas sem confirmação regional. Unidades sobrepostas ficam em linhas regionais distintas. Coordenadas CNEFE e referências históricas/de curso d'água não foram promovidas a ponto operacional. Dados ausentes, conflitos e linhas sem fonte externa específica seguem pendentes.

## Arquivos

- Selecionadas: `{paths['selected'].name}` — {len(selected)} linhas; {paths['selected'].stat().st_size} bytes; SHA-256 `{sha(paths['selected'])}`.
- Pendentes: `{paths['pending'].name}` — {len(pending)} linhas; {paths['pending'].stat().st_size} bytes; SHA-256 `{sha(paths['pending'])}`.
- Resumo de contagens/hashes: `ultrafine-metadata-2026-10.json`. Evidências finais por região e lote: trinta e três arquivos listados no metadado; vínculos suplementares: `regional-overlap-pending.json`.

O resultado cobre o piloto e os onze primeiros lotes de 100, não os 1.062.956 candidatos.
'''
(OUT/'ultrafine-report-2026-10.md').write_text(report,encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))

