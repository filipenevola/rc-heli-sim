import { BILLBOARDS } from '../sim/ads';

/** The manual in Brazilian Portuguese. Keep the section order identical to help.ts (the table of contents is built from it). */
export const HELP_HTML_PT = `
<h3>Como voar <button id="help-close">×</button></h3>
<p class="version-line">RC Heli Sim <b>v${__VERSION__}</b> · build <code>${__COMMIT__}</code> · <a href="https://github.com/filipenevola/rc-heli-sim/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Notas de versão</a> · <a href="https://github.com/filipenevola/rc-heli-sim" target="_blank" rel="noopener">Código</a></p>

<section>
  <h4>A ideia</h4>
  <p>Este é um simulador de <b>helimodelo RC</b>: a física, os tamanhos, as rotações e as curvas de passo são as de
  modelos classe 450 e 700, e você assiste de onde o piloto fica no campo. Aprenda aqui, depois voe o de verdade.
  Realismo é a prioridade, então o helicóptero não ajuda você a menos que ligue uma assistência.</p>
</section>

<section>
  <h4>Controles (Modo 2)</h4>
  <ul>
    <li><b>Stick direito</b> — cíclico. Esquerda/direita = aileron (rolamento), frente/trás = profundor (arfagem).</li>
    <li><b>Stick esquerdo</b> — coletivo/acelerador (cima/baixo, sem mola) e leme (esquerda/direita, guinada).</li>
    <li><b>Teclado:</b> setas = cíclico, W/S = coletivo, A/D = leme, 1/2/3 = modo de voo, H = throttle hold,
      R = reiniciar, P = pausar, M = mudo, U = esconder/mostrar a interface, F = tela cheia, C = câmera, ? = esta ajuda.</li>
    <li><b>Ícones da barra superior:</b> passe o mouse para ver a dica no computador; em tela de toque, <b>segure</b> qualquer
      ícone para uma mini ajuda. O olho no canto superior esquerdo esconde ou mostra todo o resto; pause com ⏸.</li>
    <li><b>Toque:</b> dois gimbais na tela. Escolha o Modo 1–4 nas Configurações. O stick do acelerador fica onde você o deixa.</li>
    <li><b>Rádio de verdade:</b> conecte o adaptador/cabo USB de simulador, mexa um stick e abra Configurações → Mapeamento do rádio.
      Aperte <i>Atribuir</i> para cada função e mova aquele stick até o fim na direção pedida; <i>Calibrar curso</i> se os
      sticks não chegarem ao máximo; <i>Salvar</i>. O mapeamento fica guardado para aquele adaptador.</li>
    <li><b>Inclinação do celular:</b> Configurações → Entrada → <i>Inclinação do celular</i>. Inclinar o celular para frente/lados é o
      cíclico; o gimbal esquerdo continua sendo coletivo e leme. A posição em que você segura ao ativar é o neutro; use
      <i>Recentrar</i> na barra superior a qualquer momento. Este modo liga a assistência de <i>Atitude</i> (veja abaixo) para o
      helicóptero copiar a inclinação do celular.</li>
  </ul>
</section>

<section>
  <p><b>R</b> volta ao heliponto. <b>Shift+R</b> reinicia direto em um pairado a 6 m no Idle-Up 1 com o rotor em
  velocidade, para treinar figuras 3D sem acelerar toda vez. Fica congelado até o seu coletivo estar perto do meio,
  depois voa.</p>
  <h4>Modos de voo e chaves</h4>
  <ul>
    <li><b>Normal</b> — modo de treino. Stick embaixo = motor desligado e um pouco de passo negativo; o governor acelera conforme
      você sobe o stick e a curva de passo vai de −2° a +11°. Comece aqui: suba o stick devagar, deixe a rotação subir, depois decole.</li>
    <li><b>Idle-Up 1 / 2</b> — o governor mantém uma rotação fixa e a curva de passo é simétrica (−11° … +11°), então stick no
      centro é passo zero. Necessário para voo invertido e 3D. Só mude para ele depois de decolar.</li>
    <li><b>Throttle hold</b> — motor desligado, rotor gira livre. Use para treinar autorrotação ou como segurança quando perder o controle.
      De altura: hold ligado, baixe o coletivo para manter a rotação, depois faça o flare e puxe o passo logo antes de tocar o chão.</li>
  </ul>
</section>

<section>
  <h4>Voo invertido e 3D — a "chave de flip"</h4>
  <p>Helicópteros de passo coletivo não invertem as pás para voar de cabeça para baixo. A chave <b>Idle-Up</b> do
  rádio (às vezes chamada de modo de voo, ID1/ID2 ou stunt) muda duas coisas: a curva de acelerador fica plana, então o
  governor mantém a rotação constante, e a <b>curva de passo fica simétrica</b>: stick embaixo = −11°, centro = 0°,
  em cima = +11°. Invertido, você empurra o stick do coletivo <i>para baixo</i> e o passo negativo empurra o helicóptero para o céu.
  Todo o resto mantém o sentido em relação ao helicóptero; de onde você está, aileron e profundor parecem invertidos.</p>
  <ol>
    <li>Decole em <b>Normal</b> e suba bem acima de 20 m. Erros custam altitude.</li>
    <li>Mude para <b>Idle-Up 1</b> (botão Modo, tecla 2, ou a chave do seu rádio depois de mapeada). Mantenha o stick um pouco acima do centro:
      o pairado agora fica em uns +5° com centro = 0°.</li>
    <li><b>Flip:</b> aileron (ou profundor) total até invertido, depois centre o cíclico e <i>empurre o stick do coletivo abaixo do centro</i>
      para manter o pairado invertido. Termine o rolamento com aileron do mesmo jeito e traga o stick de volta acima do centro.</li>
    <li><b>Loop:</b> voe à frente, puxe o profundor, reduza o coletivo no topo (por volta de 0° a levemente negativo), devolva quando
      nivelar. Uma pequena "bombada" de passo na descida mantém a rotação.</li>
    <li>Volte para Normal só quando estiver de pé e longe do chão; o modo Normal tira o passo negativo.</li>
  </ol>
  <p><b>Idle-Up 2</b> é igual com mais passo (±12°/13°) e rotação mais alta para 3D agressivo.</p>
</section>

<section>
  <h4>Chaves do rádio</h4>
  <p>Em Configurações → Mapeamento do rádio você pode atribuir as chaves do seu rádio além dos sticks: <i>Atribuir chave Idle-Up</i>
  e <i>Atribuir chave Throttle hold</i>. Comece com a chave na posição desligada/Normal, clique no botão, vire a chave.
  Adaptadores USB apresentam chaves como um botão de joystick ou como um eixo extra; os dois são detectados. Enquanto uma chave não
  estiver mapeada, os botões Modo e Hold (teclas 1/2/3 e H) fazem o serviço. <i>Limpar chaves</i> devolve o controle a eles.</p>
</section>

<section>
  <h4>Depois de cada voo: o debrief</h4>
  <p>Quando você pousa (ou cai) depois de mais do que alguns segundos no ar, um cartão mostra o voo: quão firme foi o toque
  (suave é abaixo de 0,25 m/s; os esquis de um heli de verdade reclamam acima de 1 m/s), a altitude, velocidade e G máximos, o tempo
  em anel de vórtice ou estol das pás, bateria usada, e os desafios que você completou no caminho. Busque pousos mais macios
  e menos avisos; é isso que um instrutor observaria. <b>Rever o voo</b> no cartão reproduz o voo inteiro
  com os seus sticks na tela; troque de câmera enquanto roda para ver o seu pairado de lado ou de cima.</p>
  <p><b>Caderneta de voo</b> (aba Piloto): os últimos sessenta voos neste aparelho com duração, nota do pouso, altitude
  e G máximos, e uma linha que compara os seus últimos dez voos com os dez anteriores: taxa de voos limpos e
  suavidade dos pousos. É esse o número para acompanhar de semana em semana.</p>
  <h4>O que a física vai fazer com você</h4>
  <ul>
    <li><b>Anel de vórtice</b> (settling with power): descer quase na vertical mais ou menos na velocidade do fluxo do rotor e o
      disco reingere a própria esteira: o empuxo cai, fica áspero, e puxar coletivo piora. O HUD avisa.
      Saia com cíclico à frente (voe para fora) ou menos coletivo; evite descendo com alguma velocidade à frente.</li>
    <li><b>Estol das pás</b>: coletivo demais para a rotação. O rotor afoga (rpm cai, torque dispara) e a sustentação
      não vem. Alivie o coletivo e deixe a rotação se recuperar.</li>
    <li><b>Pousos duros</b> dobram os esquis: acima de uns 2,8 m/s de descida no toque o voo acabou (as bolas de espuma do
      trem de treino aguentam um pouco mais). O debrief dá nota a todo toque.</li>
    <li><b>Autorrotação</b> se voa com velocidade: coletivo no fundo em throttle hold, nariz um pouco baixo para
      manter 8–9 m/s, um flare com o nariz para cima por volta de 12 m que gasta a velocidade e sobe a rotação, nivele os esquis, depois uma
      puxada suave. Um 450 tem energia no rotor por pouco; o 700 perdoa muito mais. Um micro não consegue.</li>
    <li><b>Bateria</b>: o pack cai abaixo de 30% e o motor para em 0%. Pouse antes do aviso, ou treine a
      autorrotação que vem em seguida.</li>
    <li><b>A esteira na cauda</b>: no pairado a esteira do rotor desce reta e passa longe da cauda. Entre uns
      2 e 6 m/s de velocidade ela inclina sobre o estabilizador e o rotor de cauda: um solavanco de nariz para cima, menos autoridade de cauda e uma
      guinada áspera. Pilotos de verdade sentem isso em toda transição e no voo lento de lado; dê um toque de cíclico à frente
      e espere trabalhar o leme.</li>
    <li><b>Esquis na grama</b> deslizam no comprimento mas cravam de lado. Um toque de lado com deriva é o que
      capota um heli; pouse reto ou com um pouco de movimento à frente.</li>
    <li><b>Efeito solo</b> só existe no pairado; some com velocidade à frente, por isso uma passagem rápida e baixa afunda.</li>
    <li><b>Vento</b> (Configurações) é mais fraco perto do chão e turbulento atrás de árvores e construções; a biruta mostra
      a média. Aprenda a pairar no calmo, depois acrescente 3–5 m/s, depois leve o pairado para perto do celeiro.</li>
    <li><b>Boom strike</b>: no treinador com flybar, cíclico grande com G negativo dobra as pás contra a cauda.
      Por isso o 3D se voa em cabeças flybarless; no treinador, mantenha o coletivo positivo quando usar muito cíclico.</li>
  </ul>
</section>

<section>
  <h4>Helicópteros</h4>
  <ul>
    <li><b>450 treinador com flybar</b> — o mais macio e amortecido. O flybar mecânico dá estabilidade mas menos autoridade.</li>
    <li><b>450 flybarless</b> — eletrônica moderna em modo rate: seco e rápido, mantém a atitude em que você o deixa.</li>
    <li><b>700 3D</b> — grande, potente e rápido. Muita inércia, muito empuxo.</li>
    <li><b>250 Micro CP</b> — um micro de passo coletivo tamanho quintal: leve, rápido, nervoso, bateria curta.</li>
  </ul>
  <p><b>Dual rates na chave de modo</b> (Configurações → Entrada): rádios de verdade normalmente voam Normal com taxa de cíclico menor
  e Idle-Up com taxa cheia. O controle "Taxa no modo Normal" faz isso: 0,6 deixa o pairado suave sem mexer no 3D.</p>
  <p><b>Seu próprio helicóptero</b> (Configurações → Helicóptero → Meu helicóptero): digite o comprimento das pás, o peso total,
  a bateria e as rotações do seu modelo real, escolha flybar ou flybarless, e voe ele. Tudo o que a caixa não
  diz (inércias, geometria de rotor e cauda, arrasto, motor) é escalado entre as referências 450 e 700, então um
  550 se comporta como um 550. Fica salvo neste aparelho e na sua conta.</p>
  <p><b>Nitro</b> (Meu helicóptero → Motorização): um motor glow atrás de uma embreagem centrífuga e um tanque de
  combustível em vez de bateria. O torque tem pico perto da rotação do Idle-Up e cai acima e abaixo dela; abaixo de uns 10% de
  acelerador a embreagem solta e o rotor gira livre enquanto o motor fica em marcha lenta, por isso o hold e as autorrotações
  funcionam do jeito que funcionam no nitro. O combustível queima com a carga; o motor apaga quando seca. O som é o pulso do escapamento, não o zumbido de um motor elétrico.</p>
  <p><b>Governor desligado / giro em rate</b> (Configurações → Helicóptero → Ajustes do modelo): desligue o governor do ESC e a
  rotação cai quando você puxa coletivo, como numa curva de acelerador comum; ajuste o acelerador do Idle-Up ao seu
  passo. Mude o giro de cauda para rate e a cauda deixa de segurar o rumo: toda mudança de coletivo
  a balança e você a segura com o leme. Os dois são como os helis eram voados antes dos giros heading hold e dos governors,
  e os dois ensinam por que os modernos valem o dinheiro.</p>
  <p><b>Trem de treino</b> (Configurações → Helicóptero): a cruz de varetas e bolas que todo instrutor coloca num primeiro heli. Torna
  capotagens quase impossíveis nos pousos, custa algum peso e agilidade, e a física inclui tudo isso.
  Use nos seus primeiros pairados, depois tire.</p>
  <p><b>Ajustes do modelo</b> (Configurações → Helicóptero): curvas de passo por modo de voo, rotação, ganho do giro de cauda e taxa do cíclico,
  exatamente o que você ajustaria no seu rádio. Ganho demais faz a cauda balançar (o filtro do giro, a velocidade do servo
  e alguns milissegundos de atraso são todos modelados, então o balanço começa por volta de 250% num 450, 200% num micro; o HUD avisa e você ouve a cauda tremer); de
  menos deixa a cauda vagar. Uma rotação menor
  no Normal deixa um treinador mais manso; mais passo no Idle-Up dá mais autoridade para 3D.</p>
  <ul>
  </ul>
</section>

<section>
  <h4>Assistência</h4>
  <ul>
    <li><b>Rate (real)</b> — o stick comanda uma taxa de rolamento/arfagem. Solte e o heli mantém a inclinação. É assim que
      helimodelos funcionam e o que você precisa aprender para o de verdade.</li>
    <li><b>Atitude</b> — o stick comanda um ângulo de inclinação e o heli se nivela sozinho quando você centra o stick, como um drone de câmera.
      Mais fácil, não realista. Bom para um primeiro pairado ou para a entrada por inclinação do celular.</li>
  </ul>
</section>

<section>
  <h4>Rastro de fumaça</h4>
  <p>Aperte <b>T</b> (ou Configurações → Rastro de fumaça) para uma fita que desaparece aos poucos com os últimos 12 segundos de voo. Mostra a
  forma real do seu loop, oito ou funil de onde você está, como a fumaça faz num show, e também aparece
  nos replays.</p>
  <h4>Gráfico de telemetria</h4>
  <p>Aperte <b>Y</b> (ou Configurações → Gráfico de telemetria) para um gráfico dos últimos 30 segundos: rotação (amarelo),
  coletivo (azul), altitude (verde) e G (vermelho), como o log de telemetria de um rádio. Veja a rotação cair
  numa puxada forte com o governor desligado, ou vagar quando o ganho do giro está alto demais.</p>
  <h4>Câmera</h4>
  <p>O botão <b>Câmera</b> (ou C) alterna: <b>Piloto</b> — você fica parado no campo e a visão dá zoom com a distância, o jeito
  realista e o que transfere para o modelo de verdade; <b>Perseguição</b> — atrás da cauda, girando com o rumo;
  <b>Frente</b> — à frente do nariz olhando para trás, para treinar nose-in; <b>De cima</b> — bem acima, norte para cima, para ver a deriva;
  <b>Drone</b> — um drone de câmera circulando o modelo. Troque a qualquer momento, até em pleno voo. Em Configurações → Câmera você também
  pode escolher onde o piloto fica (heliponto, celeiro, lago, torre, estrada) ou apertar <b>G</b> para andar até onde o heli está, como
  faria no campo. A <b>seta de orientação</b> embaixo do modelo mostra para onde o nariz aponta; desligue quando nose-in
  parar de confundir.</p>
</section>

<section>
  <h4>HUD</h4>
  <p><b>Rotação</b> rpm do rotor · <b>Coletivo</b> passo das pás · <b>Potência</b> o que o motor está entregando ·
  <b>Efeito solo</b> sustentação extra perto do chão (por isso ele flutua na altura do joelho) · <b>Distância</b> de onde você está.
  Toque no HUD no celular para expandir ou recolher.</p>
</section>

<section>
  <h4>O campo e os desafios de pouso</h4>
  <p>Tudo no campo é sólido: árvores, a cerca, casas, o celeiro, fardos de feno, vacas, ovelhas, o poste da biruta. Pás
  tocando qualquer coisa é queda; esquis contra uma parede em velocidade também. A <b>biruta</b> ao lado do heliponto mostra a direção
  do vento ao vivo e murcha quando está calmo. Quatro <b>alvos de pouso</b> têm o topo amarelo com um anel branco: a mesa de piquenique (à direita
  do heliponto), a caçamba da picape (à esquerda), o pontão no lago (bem à direita) e a plataforma da torre de 7 m (bem à frente). Coloque os quatro
  apoios dos esquis dentro do anel e fique parado um momento: o simulador mede a sua distância do centro e guarda o seu
  recorde neste aparelho. Tente a mesa no modo Normal primeiro, depois a picape, o pontão, e a torre por último (é alta, pequena
  e fora do efeito solo).</p>
</section>

<section>
  <h4>O ginásio coberto</h4>
  <p>Configurações → <b>Local de voo</b> → Ginásio coberto carrega um ginásio em vez do campo: 36 × 48 m, 12 m até o
  teto, arquibancada, duas cestas, uma pilha de colchões e um plinto para pousar, e sem vento. É o lugar do
  micro 250 e do trabalho de pairado apertado; paredes, teto, cestas e arquibancada mordem. Os circuitos e os desafios de
  pairado funcionam aqui dentro; os que precisam de altura, vento ou dos alvos do campo aparecem como "Só no campo".</p>
  <h4>Outdoors: o portfólio da Quave Holdings</h4>
  <p>Os outdoors ao redor do campo são as empresas e produtos da <a href="https://quaveholdings.com/portfolio" target="_blank" rel="noopener">Quave Holdings</a>,
  o grupo por trás deste simulador. Toque ou clique num outdoor na cena para abrir o site, ou use os links aqui:</p>
  <ul>
    ${BILLBOARDS.map((b) => `<li><a href="${b.url}" target="_blank" rel="noopener"><b>${b.name}</b></a> — ${b.tagline}</li>`).join('')}
  </ul>
</section>

<section>
  <h4>Me mostre / Me ensine</h4>
  <p>Todo desafio tem dois botões no painel de Desafios. <b>Me mostre</b>: um piloto demonstrador faz o desafio inteiro na
  física real enquanto dois gimbais grandes mostram exatamente onde estão os sticks dele, com uma legenda por passo e o estado das chaves. Nada
  do que a demonstração faz conta para a sua pontuação. <b>Me ensine</b>: você voa. Os mesmos passos e legendas, mas agora um anel tracejado em cada
  gimbal mostra onde o seu stick deveria estar neste instante (calculado a partir do que o helicóptero está fazendo agora), as chaves
  avisam quando virar o Idle-Up ou o Hold, um <b>fantasma</b> azul translúcido voa o passo atual ao seu lado, e um passo só
  avança quando você consegue. Uma queda volta ao heliponto e recomeça a
  lição. O que você voa no Me ensine conta para os desafios e rankings.</p>
</section>

<section>
  <h4>Antes de voar o de verdade</h4>
  <p>O que transfere daqui para o campo, e o que não. O simulador é honesto com a física, mas não consegue
  checar o seu modelo. Antes do primeiro voo real do dia:</p>
  <ul>
    <li><b>Tracking e balanceamento das pás</b>: uma vibração no simulador é um controle de ajuste; no heli de verdade é uma pá
      frouxa ou um eixo torto. Paire na altura dos olhos e olhe a borda do disco: uma linha só, não duas.</li>
    <li><b>Rotação e faixa de passo</b>: iguale os ajustes do modelo no simulador aos do seu rádio (Configurações → Ajustes do
      modelo). Um pairado em uns 5–6° de passo e a rotação para a qual suas pás são especificadas; passo demais com rotação de
      menos é o estol das pás que você conheceu aqui.</li>
    <li><b>Ganho do giro</b>: ajuste logo abaixo do balanço, como você achou nos Ajustes do modelo. Cauda balançando no heli de verdade
      significa a mesma coisa: ganho demais, ou correia ou servo folgados.</li>
    <li><b>Teste de alcance e failsafe</b>: um rádio de verdade tem modo de teste de alcance; use, e saiba o que o receptor
      faz ao perder sinal (throttle hold é a resposta certa para um heli).</li>
    <li><b>Vento</b>: seu limite no simulador é um número; lá fora, a sombra de construções e árvores é turbulenta e o pairado
      deriva do jeito que o desafio de vento cruzado mostrou. Primeiros voos reais: ar calmo, de manhã cedo.</li>
    <li><b>Bateria e timer</b>: programe um timer para pousar com 30% restantes. A queda de tensão que você sentiu aqui abaixo de 30% é real e vem
      com o rotor afogando.</li>
    <li><b>Sua posição</b>: fique onde o piloto fica no simulador, modelo 5–10 m à frente, cauda para você, e faça
      exatamente a primeira lição: acelerar, leve nos esquis, subir até a altura do joelho, segurar, pousar. Nada mais naquele dia.</li>
  </ul>
  <p>Mantenha o simulador honesto também: voe na câmera Piloto, com assistência Rate, com o seu próprio rádio, nas mesmas
  orientações que pretende voar lá fora.</p>
</section>

<section>
  <h4>Trilha de aprendizado</h4>
  <p>Os desafios seguem a progressão que todo instrutor de helimodelo ensina, agrupados por nível:</p>
  <ol>
    <li><b>Iniciante</b>: primeiro pairado com a cauda para você, caixa de pairado, de lado para os dois lados, o Elevador (só coletivo), pousos na mesa de
      piquenique e de precisão, cinco minutos no ar. Modo Normal, treinador 450, sem vento.</li>
    <li><b>Intermediário</b>: pairado nose-in (o grande: o cíclico parece invertido), pirueta, oito, o circuito de anéis,
      pousos na picape e no pontão, quinze minutos no ar. Acrescente vento nas Configurações quando estes estiverem fáceis.</li>
    <li><b>Avançado</b>: pouso na torre fora do efeito solo, circuito nose-in, stall turn, autorrotação.</li>
    <li><b>3D</b>: rolamento, loop, pairado invertido, funil, tic-toc, piro flip. Idle-Up, bem alto, e muito Me mostre antes.</li>
  </ol>
  <p>Regra de ouro do campo: não passe para o próximo item até o atual ficar chato.</p>
  <p>Quedas: uma pá tocando algo ou uma batida forte encerra o voo. O aviso de queda oferece <b>Rever os últimos 10 s</b>: o seu voo
  é reproduzido com os seus próprios comandos nos gimbais grandes para você ver o que deu errado. Depois R ou Reiniciar.</p>
</section>
`;
