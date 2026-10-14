// Sincronização do 9º ano: reservas exclusivas e ranking por turma.
(() => {
  const ids = ANIMALS.map(a => a.id);
  const playerId = localStorage.getItem('geo_player_id') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  localStorage.setItem('geo_player_id', playerId);
  let players = [];
  let stream;
  let connected = false;
  let claimed = false;
  const originalGet = getClassData;
  const originalSave = saveClassData;
  const originalClose = closeUserModal;

  const isLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || (window.location.port !== '' && window.location.port !== '80' && window.location.port !== '443');
  const scoreKeys = ['s0','s1','s2','s3','timeline'];

  function liveData() {
    const data = originalGet();
    data.takenAnimals = {};
    for (const p of players) {
      if (ids[p.animal]) {
        data.takenAnimals[ids[p.animal]] = true;
        if (p.score9) data.scores[ids[p.animal]] = p.score9;
      }
    }
    return data;
  }
  getClassData = liveData;

  saveClassData = function (data) {
    originalSave(data);
    if (!claimed) return;
    const sc = data.scores[currentAnimalId];
    if (!sc) return;
    const score = {};
    for (const key of scoreKeys) score[key] = Number(sc[key]) || 0;
    score.total = scoreKeys.reduce((sum, key) => sum + score[key], 0);

    if (isLocalApi) {
      fetch('/api/nono-score', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({room:currentClassCode,playerId,score})})
        .then(r => { if (!r.ok) throw new Error('Falha no ranking'); })
        .catch(() => { window.alert('A pontuação não chegou ao ranking. Confira a conexão antes de continuar.'); });
    } else {
      fetch('https://ntfy.sh/sp-escola-9ano-' + currentClassCode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'score', room: currentClassCode, playerId, animal: ids.indexOf(currentAnimalId), score })
      }).catch(() => {});
    }
  };

  function refresh() {
    updateHeaderBadge();
    if (!$('rankingModal').classList.contains('hidden')) renderRankingTable();
    if (!$('userModal').classList.contains('hidden')) renderAnimalSelectionGrid();
  }

  function connect(room) {
    if (stream) stream.close();
    connected = false;
    players = [];
    refresh();

    if (isLocalApi) {
      stream = new EventSource('/api/stream/' + room);
      stream.onmessage = e => {
        const data = JSON.parse(e.data);
        players = data.players || [];
        connected = true;
        refresh();
      };
      stream.onerror = () => { connected = false; refresh(); };
    } else {
      stream = new EventSource('https://ntfy.sh/sp-escola-9ano-' + room + '/sse');
      stream.onopen = () => {
        connected = true;
        refresh();
        if (claimed) {
          const sc = getClassData().scores[currentAnimalId] || {};
          fetch('https://ntfy.sh/sp-escola-9ano-' + room, {
            method: 'POST',
            body: JSON.stringify({ type: 'claim', room, playerId, animal: ids.indexOf(currentAnimalId), score: sc })
          }).catch(() => {});
        }
      };
      stream.onmessage = e => {
        try {
          const raw = JSON.parse(e.data);
          const data = typeof raw.message === 'string' ? JSON.parse(raw.message) : raw;
          if (data.type === 'claim') {
            const ex = players.find(p => p.id === data.playerId);
            if (ex) {
              ex.animal = data.animal;
              if (data.score) ex.score9 = data.score;
            } else {
              players.push({ id: data.playerId, animal: data.animal, score9: data.score || { s0:0,s1:0,s2:0,s3:0,timeline:0,total:0 } });
            }
            refresh();
          } else if (data.type === 'score') {
            const ex = players.find(p => p.id === data.playerId);
            if (ex) {
              ex.score9 = data.score;
              refresh();
            }
          }
        } catch(err) {}
      };
      stream.onerror = () => {
        connected = true;
        refresh();
      };
    }
  }

  renderAnimalSelectionGrid = function () {
    const room = $('inputClassCode').value;
    const taken = new Map(players.filter(p => p.id !== playerId).map(p => [ids[p.animal], true]));
    $('animalGrid').innerHTML = ANIMALS.map(a => {
      const busy = taken.has(a.id);
      const selected = selectedAnimalForModal === a.id;
      return `<div class="animal-option ${busy?'taken':''} ${selected?'selected':''}" ${busy?'':`onclick="selectAnimalModal('${a.id}')"`}><div class="animal-avatar">${a.avatar}</div><div class="animal-name">${a.name}</div><div class="animal-taken-tag">${busy?'🔒 Ocupado nesta turma':connected?'Disponível':'Conectando…'}</div></div>`;
    }).join('');
    $('btnConfirmUser').disabled = !connected;
  };

  onClassCodeChange = function () { selectedAnimalForModal = null; connect($('inputClassCode').value); };
  openUserModal = function () {
    $('inputClassCode').value = currentClassCode;
    selectedAnimalForModal = claimed ? currentAnimalId : null;
    $('userModal').classList.remove('hidden');
    connect(currentClassCode);
  };
  closeUserModal = function () { if (claimed) originalClose(); };

  confirmUserSelection = async function () {
    const room = $('inputClassCode').value;
    const animal = ids.indexOf(selectedAnimalForModal);
    if (!connected || !/^9[ABC]$/.test(room) || animal < 0) { alert('Escolha a turma e um animal disponível.'); return; }
    const button = $('btnConfirmUser');
    button.disabled = true;

    try {
      if (isLocalApi) {
        const response = await fetch('/api/claim', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,playerId,animal})});
        const result = await response.json();
        if (!response.ok || !result.success) {
          players = result.players || players;
          renderAnimalSelectionGrid();
          alert(result.message || 'Esse animal já foi escolhido. Selecione outro.');
          return;
        }
        players = result.players || [];
      } else {
        const busy = players.some(p => p.id !== playerId && p.animal === animal);
        if (busy) {
          alert('Esse animal já foi escolhido nesta turma. Selecione outro.');
          return;
        }
        const existing = players.find(p => p.id === playerId);
        if (existing) existing.animal = animal;
        else players.push({ id: playerId, animal, score9: { s0:0,s1:0,s2:0,s3:0,timeline:0,total:0 } });

        fetch('https://ntfy.sh/sp-escola-9ano-' + room, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'claim', room, playerId, animal })
        }).catch(() => {});
      }

      currentClassCode = room;
      currentAnimalId = selectedAnimalForModal;
      claimed = true;
      localStorage.setItem('geo_class_code', room);
      localStorage.setItem('geo_animal_id', currentAnimalId);
      originalClose();
      refresh();
      render();
    } catch {
      alert('Não foi possível conectar ao ranking. Confira a internet e tente novamente.');
    } finally { button.disabled = false; }
  };

  openUserModal();
})();
