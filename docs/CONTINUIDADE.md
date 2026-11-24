# Continuidade do CRM WorkGeo

Entrega do código em 24/11/2026: https://github.com/TiagoTameirao/workgeo-crm (privado, conta pessoal).

## O que foi entregue

Código da aplicação, migrações, testes, scripts de importação/backup/restauração, configurações sem segredos, documentação e dados de apoio utilizados pelo código. A pasta data contém uma base inicial histórica e referências geográficas/documentais; não é uma exportação atual da produção. Compartilhe o repositório somente com pessoas autorizadas.

## O que continua fora do Git

O banco operacional Turso e os anexos privados Vercel Blob continuam nos serviços existentes. Não foram transferidos nem alterados. Arquivos .env reais, chaves, senhas, backups, sessões, arquivos temporários e bases brutas de prospecção não estão nesta entrega. Copiar o código não recupera os cadastros atuais nem os anexos.

## Preparar uma máquina

1. Instale Node.js 24 e clone o repositório.
2. Execute npm ci.
3. Copie .env.example para .env.local e configure valores próprios de desenvolvimento. Nunca use credenciais da produção para testes.
4. Consulte lib/db.mjs e os scripts de migração antes de inicializar uma base. SQLite local é para desenvolvimento; não execute carga inicial nem migrações contra produção sem backup e revisão do responsável.
5. Execute npm test, npm run typecheck e npm run build. Para desenvolvimento, execute npm run dev.

## Dar continuidade à produção

A referência de hospedagem registrada no projeto é https://workgeo-crm.vercel.app. O responsável deve receber acessos administrativos à Vercel, ao Turso, ao Blob e às integrações efetivamente utilizadas. Confirme o estado atual diretamente nas contas; documentos anteriores contêm informações históricas.

Transfira as variáveis de ambiente por um cofre corporativo, fora do Git. Preserve BACKUP_KEY: ela é necessária para conteúdo criptografado. As credenciais de banco, armazenamento, autenticação e integrações devem ser conferidas pelo responsável técnico.

Antes de qualquer troca, obtenha uma cópia consistente e atual do banco e dos anexos e teste a restauração em ambiente isolado. A rotina automática integral de backup da base grande não foi validada nesta entrega. A exportação JSON da aplicação é uma fotografia e não contém os binários dos anexos nem substitui uma recuperação integral.

## Manter atualizado

Cada cadastro salvo continua no banco utilizado pela aplicação. GitHub armazena o código: alterações de programação exigem commit e push. Esta entrega inicial não configurou publicação automática na Vercel nem sincronização automática de dados ou arquivos com GitHub. Os scripts locais existentes não foram reconfigurados para enviar mudanças automaticamente.

## Compartilhar

Convide a pessoa em Settings > Collaborators > Add people. O link sozinho não libera acesso. Para continuidade institucional, a empresa deve assumir o controle das contas e definir responsáveis pela recuperação e manutenção.
