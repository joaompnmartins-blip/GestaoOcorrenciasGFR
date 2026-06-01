'use strict';

// Replicação da lógica de cálculo do limite operacional do frontend
// (doQuickOp em Gestao_Meios_v17.html)
function calcLimiteOp(dataChegada, horaChegada, horasMax) {
  const arr = new Date(`${dataChegada}T${horaChegada}`);
  const lim = new Date(arr.getTime() + horasMax * 3600000);
  return {
    limStr:   lim.toTimeString().slice(0, 5),
    limDate:  lim.toISOString().split('T')[0],
  };
}

describe('calcLimiteOp — cálculo de limite operacional', () => {
  test('chegada 08:00 + 12h = limite 20:00 mesmo dia', () => {
    const { limStr, limDate } = calcLimiteOp('2026-06-01', '08:00:00', 12);
    expect(limStr).toBe('20:00');
    expect(limDate).toBe('2026-06-01');
  });

  test('chegada 20:00 + 8h = limite 04:00 dia seguinte', () => {
    const { limStr, limDate } = calcLimiteOp('2026-06-01', '20:00:00', 8);
    expect(limStr).toBe('04:00');
    expect(limDate).toBe('2026-06-02');
  });

  test('chegada 23:30 + 12h = limite 11:30 dia seguinte', () => {
    const { limStr, limDate } = calcLimiteOp('2026-06-01', '23:30:00', 12);
    expect(limStr).toBe('11:30');
    expect(limDate).toBe('2026-06-02');
  });

  test('chegada 12:00 + 6h = limite 18:00 mesmo dia', () => {
    const { limStr, limDate } = calcLimiteOp('2026-06-01', '12:00:00', 6);
    expect(limStr).toBe('18:00');
    expect(limDate).toBe('2026-06-01');
  });

  test('chegada 22:00 + 12h = limite 10:00 dia seguinte', () => {
    const { limStr, limDate } = calcLimiteOp('2026-06-01', '22:00:00', 12);
    expect(limStr).toBe('10:00');
    expect(limDate).toBe('2026-06-02');
  });
});

describe('estados de meios — mapeamento', () => {
  const estadoMap = {
    transito:       { l: 'EM TRÂNSITO',   cls: 'badge-transit' },
    operacao:       { l: 'EM OPERAÇÃO',   cls: 'badge-op' },
    descanso:       { l: 'DESCANSO',      cls: 'badge-rest' },
    desmobilizado:  { l: 'DESMOBILIZADO', cls: 'badge-demob' },
    previsto:       { l: 'PREVISTO',      cls: 'badge-previsto' },
  };

  test('todos os estados têm label e classe CSS', () => {
    ['transito', 'operacao', 'descanso', 'desmobilizado', 'previsto'].forEach(e => {
      expect(estadoMap[e]).toBeDefined();
      expect(estadoMap[e].l).toBeTruthy();
      expect(estadoMap[e].cls).toBeTruthy();
    });
  });

  test('estado previsto existe no mapa', () => {
    expect(estadoMap.previsto.l).toBe('PREVISTO');
    expect(estadoMap.previsto.cls).toBe('badge-previsto');
  });
});
