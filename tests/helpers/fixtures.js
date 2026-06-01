'use strict';

const ocorrenciaBase = {
  local_ignicao: 'Serra de Teste',
  codigo_ocorrencia: 'TST-2026-001',
  subregiao: 'Sub-Região Norte',
  concelho: 'Concelho Teste',
  obs: 'Ocorrência de teste',
  inicio: '2026-06-01T10:00:00Z',
  status: 'active',
};

const meioBase = {
  eq: 'VFCI-TEST-001',
  tipo: 'VFCI',
  matricula: 'AA-00-BB',
  concelho: 'Concelho Teste',
  setor: 'ALFA',
  operacionais: 3,
  responsavel: 'João Teste',
  contacto: '910000000',
  estado: 'transito',
};

const meioPrevistoBase = {
  eq: 'VFCI-TEST-002',
  tipo: 'VFCI',
  estado: 'previsto',
  previsto_data: '2026-06-02',
  previsto_hora: '08:00:00',
  operacionais: 3,
};

const equipaBase = {
  nome: 'VFCI-GFR-TEST-001',
  tipo: 'VFCI',
  tipo_equipa: 'GFR',
  subregiao: 'Sub-Região Norte',
  concelho: 'Concelho Teste',
  capacidade: 3,
  origem: 'ICNF',
};

const operacionalBase = {
  nome: 'Operacional Teste',
  categoria: 'GFR',
  contacto: '910000001',
  notas: null,
};

module.exports = {
  ocorrenciaBase,
  meioBase,
  meioPrevistoBase,
  equipaBase,
  operacionalBase,
};
