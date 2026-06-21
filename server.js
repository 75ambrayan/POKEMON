const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// Servidor HTTP base (necesario para Railway)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Pokemon Battle Server OK');
});

const wss = new WebSocketServer({ server });

// salas[codigoSala] = { jugador1: ws, jugador2: ws, estado: {...} }
const salas = {};

function generarCodigo() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function enviar(ws, tipo, datos) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ tipo, ...datos }));
  }
}

function otroJugador(sala, ws) {
  return sala.jugador1 === ws ? sala.jugador2 : sala.jugador1;
}

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.tipo) {

      case 'crear_sala': {
        let codigo;
        do { codigo = generarCodigo(); } while (salas[codigo]);

        salas[codigo] = {
          jugador1: ws,
          jugador2: null,
          nombres: {},
          pokemons: {},
        };
        ws.codigoSala = codigo;
        ws.numJugador = 1;

        enviar(ws, 'sala_creada', { codigo });
        break;
      }

      case 'unirse_sala': {
        const { codigo } = msg;
        const sala = salas[codigo];

        if (!sala) {
          enviar(ws, 'error', { mensaje: 'No existe esa sala. Revisá el código.' });
          return;
        }
        if (sala.jugador2) {
          enviar(ws, 'error', { mensaje: 'La sala ya está llena.' });
          return;
        }

        sala.jugador2 = ws;
        ws.codigoSala = codigo;
        ws.numJugador = 2;

        enviar(ws, 'sala_unida', { codigo });
        enviar(sala.jugador1, 'oponente_conectado', {});
        break;
      }

      case 'set_nombre': {
        const sala = salas[ws.codigoSala];
        if (!sala) return;

        sala.nombres[ws.numJugador] = msg.nombre;
        const otro = otroJugador(sala, ws);
        enviar(otro, 'nombre_oponente', { nombre: msg.nombre, jugador: ws.numJugador });
        break;
      }

      case 'set_pokemon': {
        const sala = salas[ws.codigoSala];
        if (!sala) return;

        sala.pokemons[ws.numJugador] = msg.pokemon;
        const otro = otroJugador(sala, ws);
        enviar(otro, 'oponente_eligio', { jugador: ws.numJugador });

        if (sala.pokemons[1] && sala.pokemons[2]) {
          const resultado = calcularResultado(sala);
          enviar(sala.jugador1, 'batalla_lista', {
            miPokemon: sala.pokemons[1],
            oponentePokemon: sala.pokemons[2],
            miNombre: sala.nombres[1],
            oponenteNombre: sala.nombres[2],
            resultado,
          });
          enviar(sala.jugador2, 'batalla_lista', {
            miPokemon: sala.pokemons[2],
            oponentePokemon: sala.pokemons[1],
            miNombre: sala.nombres[2],
            oponenteNombre: sala.nombres[1],
            resultado: invertirResultado(resultado, sala),
          });
        }
        break;
      }

      case 'jugar_de_nuevo': {
        const sala = salas[ws.codigoSala];
        if (!sala) return;

        sala.pokemons = {};
        const otro = otroJugador(sala, ws);
        enviar(otro, 'reiniciar', {});
        break;
      }
    }
  });

  ws.on('close', () => {
    const sala = salas[ws.codigoSala];
    if (!sala) return;

    const otro = otroJugador(sala, ws);
    enviar(otro, 'oponente_desconectado', {});
    delete salas[ws.codigoSala];
  });
});

// Mantener conexiones vivas
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function calcularResultado(sala) {
  const p1 = sala.pokemons[1];
  const p2 = sala.pokemons[2];
  if (p1.statTotal > p2.statTotal) return 'gane';
  if (p2.statTotal > p1.statTotal) return 'perdi';
  return 'empate';
}

function invertirResultado(resultado) {
  if (resultado === 'gane') return 'perdi';
  if (resultado === 'perdi') return 'gane';
  return 'empate';
}

server.listen(PORT, () => {
  console.log(`🎮 Pokemon Battle Server corriendo en puerto ${PORT}`);
});