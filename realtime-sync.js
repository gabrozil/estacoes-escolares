/**
 * realtime-sync.js
 * Camada de sincronização em tempo real e reserva exclusiva multi-aparelho
 * para a atividade interativa "Governo Dutra e Guerra Fria".
 * 
 * Funcionalidades:
 * 1. Reserva atômica de animais entre dispositivos diferentes (evita conflitos em tempo real).
 * 2. Atualização automática do ranking da turma em todos os celulares/computadores via Server-Sent Events (SSE).
 * 3. Bloqueio de novas reservas quando o servidor estiver inacessível, para evitar animais duplicados.
 * 4. Indicador visual discreto de status de rede.
 */

(() => {
  // Determina a base da API
  const apiBase = (() => {
    if (window.location.protocol.startsWith('http')) {
      return window.location.origin;
    }
    // Caso seja aberto via file:///
    const params = new URLSearchParams(window.location.search);
    return params.get('api') || 'http://localhost:3000';
  })();

  let eventSource = null;
  let isSyncingFromServer = false;
  let connectionStatus = 'connecting'; // 'connected' | 'connecting' | 'offline'

  const getPlayerId = () => {
    return sessionStorage.getItem('dutra-player-id') || (typeof playerId !== 'undefined' ? playerId : '');
  };

  const getRoom = () => {
    const fromUrl = new URLSearchParams(window.location.search).get('turma');
    const inputVal = document.getElementById('roomInput')?.value;
    const fromStorage = localStorage.getItem('dutra-current-room');
    const r = fromUrl || (typeof room !== 'undefined' && room) || inputVal || fromStorage || '';
    return r.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  };

  // Cria e insere badge visual de conectividade na barra de status
  function createOrUpdateBadge(status, text) {
    let badge = document.getElementById('rt-status-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'rt-status-badge';
      badge.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 10px;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 12px;
        background: #eef2f5;
        color: #3b505c;
        vertical-align: middle;
        transition: all 0.3s ease;
      `;
      const targetParent = document.querySelector('.ranktop');
      if (targetParent) {
        targetParent.appendChild(badge);
      }
    }

    const dotColors = {
      connected: '#23a05a',
      connecting: '#e89e27',
      offline: '#94a3b8'
    };
    const defaultLabels = {
      connected: 'Tempo real ativo (multi-aparelho)',
      connecting: 'Conectando ao servidor...',
      offline: 'Modo local (offline)'
    };

    const color = dotColors[status] || dotColors.offline;
    const label = text || defaultLabels[status] || defaultLabels.offline;

    badge.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 5px ${color}"></span>
      <span>${label}</span>
    `;
  }

  // Conecta ao fluxo SSE da turma
  function connectStream(roomCode) {
    if (!roomCode || roomCode.length < 2) {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      createOrUpdateBadge('offline', 'Aguardando código da turma');
      return;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    createOrUpdateBadge('connecting');

    try {
      const streamUrl = `${apiBase}/api/stream/${encodeURIComponent(roomCode)}`;
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        connectionStatus = 'connected';
        createOrUpdateBadge('connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'room_update' || payload.type === 'room_init') {
            applyServerRoomData(roomCode, payload.players);
          }
        } catch (e) {
          console.error('[RealtimeSync] Erro ao processar mensagem SSE:', e);
        }
      };

      eventSource.onerror = () => {
        connectionStatus = 'offline';
        createOrUpdateBadge('offline', 'Servidor offline (usando modo local)');
      };
    } catch (e) {
      connectionStatus = 'offline';
      createOrUpdateBadge('offline', 'Servidor offline (usando modo local)');
    }
  }

  // Aplica dados recebidos do servidor ao localStorage e re-renderiza ranking
  function applyServerRoomData(roomCode, players) {
    const key = 'dutra-room-' + roomCode;
    isSyncingFromServer = true;
    try {
      localStorage.setItem(key, JSON.stringify({ players: players || [] }));
    } finally {
      isSyncingFromServer = false;
    }

    if (typeof updateRank === 'function') {
      updateRank();
    }
    // Se o player atual já tiver animal, garante que o botão próximo seja atualizado
    if (typeof render === 'function') {
      const nextBtn = document.getElementById('next');
      const p = (players || []).find(x => x.id === getPlayerId());
      if (p && nextBtn && nextBtn.disabled && window.station !== undefined) {
        render();
      }
    }
  }

  // Intercepta a tentativa de reserva de animal para garantir exclusividade entre aparelhos
  async function attemptExclusiveClaim(animalIndex) {
    const roomCode = getRoom();
    const pid = getPlayerId();
    const msgEl = document.getElementById('roomMessage');

    if (!roomCode || roomCode.length < 2) {
      if (msgEl) msgEl.textContent = 'Escolha sua turma antes de selecionar o animal.';
      return;
    }

    if (msgEl) {
      msgEl.textContent = 'Confirmando reserva exclusiva com o servidor...';
    }

    try {
      const response = await fetch(`${apiBase}/api/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: roomCode,
          playerId: pid,
          animal: animalIndex
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Reserva exclusiva efetuada com sucesso no servidor!
        applyServerRoomData(roomCode, data.players);
        if (typeof render === 'function') render();
        if (msgEl && typeof animals !== 'undefined' && animals[animalIndex]) {
          msgEl.textContent = `Você é ${animals[animalIndex][0]} ${animals[animalIndex][1]} nesta turma (reserva confirmada entre aparelhos).`;
        }
      } else {
        // Conflito (409) ou outro aparelho já escolheu este animal
        if (data.players) {
          applyServerRoomData(roomCode, data.players);
        }
        if (msgEl) {
          msgEl.textContent = data.message || 'Esse animal já foi escolhido nesta turma por outro aparelho. Selecione outro.';
        }
      }
    } catch (err) {
      console.warn('[RealtimeSync] Servidor inacessível:', err);
      connectionStatus = 'offline';
      createOrUpdateBadge('offline', 'Servidor indisponível');
      if (msgEl) msgEl.textContent = 'Não foi possível reservar o animal. Aguarde a conexão com o servidor e tente novamente.';
    }
  }

  // Intercepta cliques de animais na fase de captura do DOM (useCapture: true)
  function attachAnimalInterception() {
    const animalContainer = document.getElementById('animalChoices');
    if (!animalContainer) return;

    animalContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('button.animal');
      if (!btn || btn.disabled) return;

      // Interrompe imediatamente a execução do onclick nativo do HTML original
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const animalIndex = +btn.dataset.animal;
      await attemptExclusiveClaim(animalIndex);
    }, true);
  }

  // Intercepta alterações no localStorage para enviar pontuações automaticamente ao servidor
  function hookLocalStorage() {
    const originalSetItem = localStorage.setItem.bind(localStorage);

    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);

      // Não propaga se a gravação veio de uma sincronização do próprio servidor
      if (isSyncingFromServer) return;

      const roomCode = getRoom();
      if (key === 'dutra-room-' + roomCode) {
        try {
          const parsed = JSON.parse(value);
          const p = parsed.players?.find(x => x.id === getPlayerId());
          if (p && p.points && connectionStatus === 'connected') {
            fetch(`${apiBase}/api/sync-player`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                room: roomCode,
                playerId: getPlayerId(),
                points: p.points
              })
            }).catch(e => console.warn('[RealtimeSync] Erro no sync de pontuação:', e));
          }
        } catch {}
      }
    };
  }

  // Inicialização quando o DOM estiver pronto
  function init() {
    hookLocalStorage();
    attachAnimalInterception();

    // Monitora o botão de entrar na turma
    const enterBtn = document.getElementById('enterRoom');
    const roomInput = document.getElementById('roomInput');

    const onRoomChanged = () => {
      setTimeout(() => {
        const r = getRoom();
        connectStream(r);
      }, 50);
    };

    if (enterBtn) enterBtn.addEventListener('click', onRoomChanged);
    if (roomInput) {
      roomInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onRoomChanged();
      });
    }

    // Conecta imediatamente se já houver turma definida (via URL ou localStorage)
    const initialRoom = getRoom();
    if (initialRoom && initialRoom.length >= 2) {
      connectStream(initialRoom);
    } else {
      createOrUpdateBadge('offline', 'Aguardando código da turma');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
