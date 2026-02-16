---
name: revenue-experiment-tracker
description: Rastrear, organizar e priorizar experimentos de receita (growth/monetizacao) com ROI esperado, dono e prazo. Use quando o usuario pedir para registrar/atualizar experimentos, rankear proximos passos, resumir status de pipeline de receita ou montar um plano enxuto de acoes com impacto e esforco.
---

# Revenue Experiment Tracker

## Overview

Organize experimentos de receita em um formato simples e comparavel, com ranking de impacto. Entregue um resumo objetivo com proximos passos e criterios claros.

## Fluxo Rapido

1. Coletar contexto minimo
Definir periodo, objetivo (ex: MRR, conversao, ARPU), e quantos experimentos existem.

2. Montar tabela base
Para cada experimento, registrar:
- `nome`
- `hipotese`
- `roi_esperado`
- `esforco` (baixo/medio/alto ou 1-5)
- `owner`
- `prazo`
- `status` (ideia, pronto, em_execucao, pausado, concluido)
- `resultado` (se concluido)

3. Rankear proximos passos
Calcular prioridade simples:
- `score = (roi_esperado * impacto_peso) - (esforco * esforco_peso) - (risco * risco_peso)`
Se o usuario nao fornecer pesos, usar `impacto_peso=1`, `esforco_peso=0.5`, `risco_peso=0.5`.

4. Entregar saida clara
Resumo curto, top 5 experimentos com score e 1 acao por experimento.

## Regras de Qualidade

1. Nao inventar numeros sem fonte; pedir aproximacoes quando necessario.
2. Manter tudo legivel para leigos: frases curtas e sem jargao.
3. Se houver poucos dados, entregar um “ranking preliminar” e apontar o que falta.
4. Nunca misturar objetivos: um ranking por objetivo de receita.

## Exemplo de Pedido

“Liste meus experimentos de receita, ranqueie os proximos 5 e me diga quem e o dono e o prazo.”

## Exemplo de Resposta (formato)

Tabela + resumo:
- `nome | score | owner | prazo | proximo_passo`
- 3 linhas de resumo com principais bloqueios
