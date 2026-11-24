# Evolução operacional WorkGeo — 28/10/2026

## Backup antes das alterações

A cópia `backups/before-evolution-2026-10-28T17-49-05-866Z/` foi concluída **antes** de alterar os arquivos da aplicação. `verification.json` registra as verificações e os hashes.

- Implantação anterior preservada: `dpl_5AJ6BXRotA4JLVmA7jD3iHzNNLhi` (`workgeo-hjodcor7z-tiagotameiraos-projects.vercel.app`).
- `source.tar.gz`: código local anterior, incluindo dependências declaradas e testes; não contém variáveis de ambiente, caches ou dados temporários.
- `configuration.enc`: configuração privada criptografada; nunca abrir ou imprimir em logs compartilhados.
- `database.sql.gz.enc`: exportação SQL completa atual do Turso, comprimida e criptografada. Não é a reconstrução histórica de 20/10.
- `files/` e `files-manifest.enc`: três arquivos privados criptografados e seus metadados/hashes.
- Restauração real em SQLite isolado: 33 tabelas, 149.905 candidatos, 27 unidades; integridade OK e zero erros de vínculos. Contagens da origem antes/depois coincidiram com a restauração. Os três arquivos foram decifrados e comparados byte a byte.
- A chave `BACKUP_KEY` permanece separada. Não a incluir na documentação nem junto à cópia em texto aberto.

O formato do dump é `WGS1` + IV de 12 bytes + conteúdo gzip cifrado AES-256-GCM + tag final de 16 bytes. Os arquivos e a configuração usam `WG02` + IV de 12 bytes + tag de 16 bytes + conteúdo cifrado. A restauração de teste foi feita por `runtime/prechange-backup.mjs`; sua localização está no relatório. Estes formatos não são entrada do restaurador legado `scripts/restore.mjs`.

Para conferir novamente em um arquivo novo e isolado, com a chave já disponível em `.env.local`, execute a partir da pasta do CRM: `node --env-file=.env.local scripts/verify-prechange-backup.mjs backups/before-evolution-2026-10-28T17-49-05-866Z nova-conferencia.sqlite`. O arquivo é criado somente em `runtime/` e o comando recusa sobrescrever um arquivo existente. A verificação checa o código, o banco, os arquivos privados, contagens e vínculos; não grava na produção.

Para o formato experimental em partes, a restauração local foi verificada com `node --env-file=.env.local scripts/restore-bundle-local.mjs teste-7e74f178340e runtime/teste-7e74f178340e nome-novo`. A saída fica em `runtime/nome-novo/` e contém dados privados legíveis; o destino deve ser novo e não é conectado à produção. Esse formato ainda não é usado pelo cron publicado.

### Retorno à versão anterior

Primeiro desativar a funcionalidade problemática. Se necessário, promover novamente a implantação anterior pelo projeto Vercel já vinculado. Os novos campos usam JSON/configurações existentes; nenhuma migration ou alteração dos candidatos é necessária para esta entrega.

**Não restaurar o banco antigo sobre novos lançamentos.** Exportar o estado atual antes de qualquer recuperação, restaurar o SQL em banco vazio separado, conferir vínculos/arquivos e reconciliar o trabalho posterior com a gestão. A restauração isolada de referência está em `runtime/prechange-restore-2026-10-28T17-49-05-866Z.sqlite` e contém dados privados; não publicar nem versionar.

## Funcionalidades implementadas

- Checklist humano estruturado por documento: instrução/fonte, versão, resultado, obrigatoriedade, justificativa e revisor real. Documento/competência/instruções alterados reiniciam a conferência. Revisões e recorrências não copiam resultados. Documentos legados não recebem conferência fictícia.
- Modelos de instruções por unidade, contrato e tipo; uma nova versão das instruções é um novo modelo. Nenhum requisito da Gerdau/Bancodoc foi presumido.
- Dossiê por unidade, contrato e competência, versões atuais e histórico, motivos de devolução e categorias. Não comprova completude da lista exigida pelo portal.
- Espera por terceiro com motivo/data; a revisão entra na fila sem adiar um prazo anterior. Filtros e contadores administrativos usam a mesma seleção.
- Preparação explícita de campanha depois do fechamento comercial. Repetir a ação abre a mesma campanha, sem duplicar. Contratos e campanhas anteriores permanecem preservados.
- Campos e avisos de passagem para campo, processamento, conferência e entrega. São orientações, não aprovação automática de voo ou parecer técnico.
- Resumo estruturado da unidade, com acesso à origem das interações, oportunidades, serviços e materiais aprovados permitidos ao perfil.
- Assistente opcional de reescrita, sem ferramentas de alteração/envio, com limite de 20 tentativas por conta/dia, timeout, proteção de números/links e rascunho original preservado. Está desativado por padrão.
- Relatos de atrito nas telas novas; amostras manuais opcionais de tempo, com período, mediana e tamanho da amostra, restritas à gestão.
- Monitoramento distingue tentativa diária, backup concluído e restauração pré-alteração verificada. Uma marcação de início sem conclusão exige conferência.

## Regras da IA

Configuração exclusivamente no servidor: `CRM_MESSAGE_AI_ENABLED=false` por padrão, `GROQ_API_KEY` e `GROQ_MODEL`. Não contratar plano, ativar chave ou enviar conteúdo real automaticamente. A API recebe apenas o rascunho selecionado; não recebe anexos nem acesso de ferramentas ao CRM. O resultado exige revisão humana mesmo quando números/links passam pela verificação.

Os 30 casos simulados verificam proteção de referências e tratamento de falhas; **não** comprovam qualidade de um modelo real ou economia de tempo. Antes de ativar, conferir conta gratuita, modelo disponível, limites e tratamento de dados; comparar 30 situações anonimizadas com Josi. Meta proposta: zero erro factual crítico e redução de pelo menos 25% da mediana do tempo total frente ao modelo contextual sem IA. Caso não cumpra, manter desativado.

## Validação humana e piloto — pendentes

1. Tiago e responsáveis reais percorrem contato → campanha → campo → processamento → conferência → entrega → administrativo. Registrar ajustes; não presumir aprovação.
2. Josi cadastra e confere o primeiro modelo documental a partir das instruções vigentes do contrato. Percorrer pendência, postagem manual, devolução e revisão.
3. Coletar referência durante cinco dias úteis, com tempo de preparação/revisão, busca de documentos e pedidos de informação entre equipes. Usar a medição opcional em Reportar atrito.
4. Após adoção das melhorias, observar dez dias úteis de uso. Comparar situações equivalentes; ausência de amostra não significa zero problema.
5. Revisar os resultados com a equipe antes de acrescentar bloqueios operacionais, leitura automática de documentos ou envio automático.

Nenhuma entrevista, coleta de cinco dias, avaliação de Josi ou piloto de dez dias é considerada concluída por compilação, teste sintético ou publicação. Não foi agendada execução futura automática.

## Limites conservados

WhatsApp/e-mail reais dependem de configuração. Checklist é manual e não garante aceite do portal. Não há emissão fiscal, upload automático no Bancodoc, previsão de fechamento, alteração de pontuação/território, roteirização automática ou conciliação autônoma.

O backup pré-alteração foi verificado localmente; o desempenho e a conclusão do cron diário integral sobre a base grande precisam de verificação separada. O monitoramento não transforma uma tentativa em cópia completa.
