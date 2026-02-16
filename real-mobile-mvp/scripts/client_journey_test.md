# Client Journey Test (Manual + Playwright)

## Objetivo
Validar a experiência ponta a ponta como cliente real:
`novo usuário -> onboarding mínimo -> tour -> home -> criar rascunho -> tentativa de envio bloqueada -> completar cadastro -> envio liberado`.

## Pré-requisitos
- App rodando em web: `npm run web`
- Limpar estado local antes do teste (novo cliente):
  - apagar storage do navegador, ou
  - desinstalar/reinstalar no dispositivo de teste

## Roteiro Manual
1. Acessar `Welcome`, escrever objetivo e autenticar.
2. Completar onboarding inicial (8 campos mínimos).
3. Concluir tour do app.
4. Na Home, confirmar card de alerta para cadastro de produção pendente.
5. Criar pedido em `Tráfego` e clicar `Enviar para Real`.
6. Confirmar redirecionamento para `Raio-X` modo produção.
7. Completar campos restantes de produção.
8. Validar retorno para `Pedidos` com envio liberado.
9. Repetir envio para `Site` e confirmar mesma regra.
10. Em `Serviços`, validar `Conteúdo` com selo `Em breve` e sem navegação ativa.
11. Acessar `/create/content` e validar tela `Em breve`.

## Playwright CLI (Opcional)
Use o wrapper do skill:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
```

Exemplo base:

```bash
"$PWCLI" open http://localhost:8081 --headed
"$PWCLI" snapshot
# Interagir por refs retornadas no snapshot (fill/click) seguindo o roteiro manual.
"$PWCLI" screenshot --output output/playwright/client-journey-home.png
```
