# Boletins, anexos e pré-validação Gerdau — 13/11/2026

## Uso

Em Administrativo → Boletins e notas, use Criar boletim em PDF e Excel. Preencha o cliente, serviço e os campos do modelo; Salvar e gerar PDF e Excel grava a medição e gera os arquivos na mesma sequência. A validação do total é compartilhada entre navegador e servidor. Os arquivos são versões independentes, com fórmulas no Excel, sem reproduzir assinaturas do exemplo e sem marcar envio ou autorização.

Arraste ou selecione arquivos nos registros de propostas, contratos, serviços, materiais, medições/notas, documentos administrativos e autorizações de voo. Os links existentes permanecem. Arquivos de até 30 MB ficam privados; acima de 3 MB o envio é direto ao armazenamento Blob. Formatos seguem a biblioteca existente; voo mantém PDF/PNG/JPG. Registros enviados/concluídos conservam restrições de edição. Substituir o arquivo mantém o anterior e reinicia a conferência documental.

Em Banco DOC, anexe o documento, selecione o tipo no manual, complete os dados de comparação e salve. Confirme a aplicação das regras atuais ao contrato somente após conferi-las. Verificar documento inicia uma análise; Continuar análise processa um lote. Continuar automaticamente segue enquanto a ficha estiver aberta, podendo pausar e retomar depois. O resultado não envia o arquivo ao portal nem substitui seu aceite.

## IA e limites

A Groq é uma integração corporativa compartilhada, já ativada. O funcionário não precisa criar conta, inserir chave nem configurar retenção. O painel técnico foi removido do fluxo documental. A chave é verificada contra a lista de modelos e guardada com AES-256-GCM usando BACKUP_KEY; nunca é devolvida ao navegador nem incluída em auditoria. O usuário declarou plano gratuito sem faturamento e retenção zero ativada na conta. Manutenção da credencial usa a configuração privada do servidor ou a API administrativa, sem formulário no produto. O modelo é qwen/qwen3.8-27b, com leitura visual e respostas JSON. A configuração continua independente do antigo assistente de mensagens.

No servidor, também são aceitos GROQ_API_KEY, CRM_DOCUMENT_AI_ENABLED=true e CRM_DOCUMENT_AI_ZDR_CONFIRMED=true. Uma configuração salva no CRM prevalece. Não configurar ambos os caminhos sem necessidade. A chave de criptografia precisa ser preservada para recuperar a integração e os backups.

A pré-validação processa PDF/PNG/JPG; demais anexos continuam baixáveis e exigem conversão ou revisão humana. PDF com senha, leitura incompleta ou documentos acima dos limites ficam inconclusivos. Limites iniciais: 200 páginas para extração, 200 mil caracteres extraídos, 12 mil caracteres para conferência integral por IA, 20 chamadas por dia para toda a aplicação e intervalo mínimo de 65 segundos. Documentos maiores precisam ser divididos ou conferidos manualmente. A cota efetiva da conta Groq pode ser menor; erro 429 não muda para serviço pago. O cursor preserva os lotes já concluídos.

A análise guarda fonte/versão/hash, contexto, páginas, critérios, evidências, modelo e autoria. Mudança de arquivo, tipo, unidade, contrato, competência ou dados comparados torna o resultado anterior desatualizado. Itens incertos ficam pendentes; não existe percentual de aceite. Autenticidade e validação criptográfica de assinatura não são demonstradas pela IA.

## Fonte e operação

O catálogo é derivado do PDF fornecido pelo usuário, versão 06/2025, SHA-256 8453200918c7b2c111632679e66a415e82b3f6c208442273061daf69194507ab: 180 tipos documentais e páginas de referência. Separa Ariba e Banco Doc. A vigência em cada contrato não foi presumida. scripts/import-gerdau-guidelines.py reproduz a extração usando PyMuPDF; não é executado no servidor. Atualizar o catálogo exige verificar a nova fonte e preservar o histórico das análises.

A migration 17 é aditiva: record_files, bulletin_versions e document_analyses. Usa SQL compatível com SQLite/libSQL e PostgreSQL; os dados centrais continuam nos registros existentes. Novas tabelas e binários referenciados participam do backup e da exportação. O índice textual da prospecção é derivado e pode ser reconstruído a partir dos cadastros preservados. Antes de migrar produção, exigir backup com restauração e integridade verificadas.

APIs autenticadas: /api/document-files (lista/envio ou ticket), /api/document-files/token e /complete (envio direto), /api/document-files/[id] (download), /api/bulletins/[id] (histórico/geração), /api/bankdoc/[id] (histórico/início/continuação), /api/bankdoc-config (estado/configuração privada). As autorizações do registro são conferidas no servidor; IDs de arquivos não concedem acesso.

## Verificação

Testes cobrem aritmética monetária e arredondamento, datas, fórmulas, PDF multipágina, permissões, preservação dos anexos, versões de boletim, invalidação do contexto, criptografia da chave, leitura textual/visual, cota, respostas incompletas e comandos dentro de documentos. Playwright percorre geração/download, arraste, análise sem credencial e tela de 390 px em base isolada. A IA real foi testada com dados fictícios, em texto e imagem; isso verifica integração, não garante a precisão dos pareceres.

## Publicação verificada

Publicado em 13/11/2026: https://workgeo-crm.vercel.app, deployment READY dpl_6dMTfRMwTKShKKRwM9CdSyM9bHRv. Backup prévio restaurado e decifrado conferido, migration 17 sem mudança nas contagens operacionais. 195 testes, typecheck e builds local/remoto aprovados. Navegador publicado autenticado verificou os painéis e a configuração ativa em desktop/celular, sem erros de página ou excesso de largura; não foram criados documentos de QA em produção. O teste real completo usou documento fictício em base local e terminou com Pendências encontradas, incluindo leitura visual e dois lotes de critérios.

Auditoria de dependências: 20 alertas moderados na cadeia de Workflow existente. A nova cadeia ExcelJS usa override de uuid para versão corrigida; não foram aplicadas atualizações alheias ao pedido.


Correção de uso publicada: dpl_C9JNbNApFHmTU9WDLjhPDiD95QZv, em 13/11/2026. Arraste visível nas abas e nos formulários desde o cadastro novo; salvar inclui o arquivo selecionado. Analisar documento salva o contexto e o anexo e continua automaticamente. Boletim novo gera PDF/Excel sem salvar/reabrir primeiro. Empresa existente pode ser selecionada no próprio formulário, incluindo somente a escolhida no catálogo administrativo. Verificação de duas contas em produção sem interface de conta/chave; fluxo completo de geração/anexo e IA automática real em base isolada.
