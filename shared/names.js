'use strict';

// Pools de nombres variados (varias regiones) para poblar automaticamente los
// asientos VENDIDOS/RESERVADOS segun la regla del 73%/3% del enunciado.
const POOLS = {
  cn: {
    given: ['Wei', 'Jing', 'Li', 'Fang', 'Hui', 'Yan', 'Jun', 'Mei', 'Tao', 'Xin', 'Lei', 'Qiang'],
    family: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou'],
  },
  jp: {
    given: ['Haruto', 'Yui', 'Sota', 'Aoi', 'Ren', 'Sakura', 'Hina', 'Riku', 'Yuto', 'Mio'],
    family: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura'],
  },
  eu: {
    given: ['Sophie', 'Lucas', 'Emma', 'Liam', 'Mia', 'Noah', 'Lea', 'Hugo', 'Anna', 'Leon', 'Clara', 'Felix'],
    family: ['Muller', 'Dubois', 'Garcia', 'Rossi', 'Van Dijk', 'Silva', 'Novak', 'Andersen', 'Kowalski'],
  },
  ar: {
    given: ['Omar', 'Layla', 'Yusuf', 'Amina', 'Khalid', 'Fatima', 'Zayd', 'Nour', 'Hassan', 'Salma'],
    family: ['Al-Farsi', 'Al-Amin', 'Haddad', 'Khalil', 'Mansour', 'Saleh', 'Nasser', 'Rahman'],
  },
  us: {
    given: ['James', 'Olivia', 'William', 'Ava', 'Benjamin', 'Isabella', 'Lucas', 'Charlotte', 'Henry', 'Amelia'],
    family: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson'],
  },
  br: {
    given: ['Joao', 'Maria', 'Pedro', 'Ana', 'Lucas', 'Beatriz', 'Gabriel', 'Larissa', 'Rafael', 'Camila'],
    family: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Almeida', 'Ferreira'],
  },
  in_: {
    given: ['Arjun', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Divya', 'Karan', 'Neha', 'Aditya', 'Sneha'],
    family: ['Sharma', 'Patel', 'Kumar', 'Singh', 'Gupta', 'Rao', 'Mehta', 'Reddy'],
  },
  tr: {
    given: ['Emre', 'Elif', 'Can', 'Zeynep', 'Mert', 'Aylin', 'Baris', 'Deniz'],
    family: ['Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Aydin', 'Ozdemir'],
  },
};

const POOL_KEYS = Object.keys(POOLS);

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Genera un nombre de pasajero determinista a partir de una funcion rng (0..1). */
function randomPassengerName(rng) {
  const poolKey = pick(POOL_KEYS, rng);
  const pool = POOLS[poolKey];
  const given = pick(pool.given, rng);
  const family = pick(pool.family, rng);
  return `${given} ${family}`;
}

module.exports = { randomPassengerName, POOLS };
