import express from 'express';
import Database from 'better-sqlite3';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res
    .status(200)
    .send({ message: 'SHIPTIVITY API. Read documentation to see API docs' });
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid id provided.',
        long_message: 'Id can only be integer.',
      },
    };
  }
  const client = db
    .prepare('select * from clients where id = ? limit 1')
    .get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid id provided.',
        long_message: 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
};

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid priority provided.',
        long_message: 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  };
};

/**
 * Validate status input
 * @param {any} status
 */
const validateStatus = (status) => {
  if (
    status !== 'backlog' &&
    status !== 'in-progress' &&
    status !== 'complete'
  ) {
    return {
      valid: false,
      messageObj: {
        message: 'Invalid status provided.',
        long_message:
          'Status can only be one of the following: [backlog | in-progress | complete].',
      },
    };
  }
  return {
    valid: true,
  };
};

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    const { valid, messageObj } = validateStatus(status);
    if (valid === false) {
      return res.status(400).send(messageObj);
    }
    const clients = db
      .prepare('select * from clients where status = ?')
      .all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res
    .status(200)
    .send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  if (status) {
    const { valid, messageObj } = validateStatus(status);
    if (!valid) {
      return res.status(400).send(messageObj);
    }
  }

  let clients = db.prepare('select * from clients').all();
  const client = clients.find((client) => client.id === id);

  if (priority) {
    const { valid, messageObj } = validatePriority(priority);
    if (!valid) {
      return res.status(400).send(messageObj);
    }
  } else {
    if (status === 'complete') {
      const completeCount = clients.filter(
        (client) => client.status === 'complete'
      ).length;
      client.status = status;
      client.priority = completeCount + 1;

      db.prepare(
        'update clients set status = ?, priority = ? where id = ?'
      ).run(status, client.priority, id);
      clients = db.prepare('select * from clients').all();
      return res.status(200).send(clients);
    } else {
      res.status(400).send({ message: 'Priority is required' });
    }
  }

  try {
    // sorting all the cards based on status
    const backlog = clients
      .filter((client) => client.status === 'backlog')
      .sort((a, b) => {
        return a.priority - b.priority;
      });
    const inProgress = clients
      .filter((client) => client.status === 'in-progress')
      .sort((a, b) => {
        return a.priority - b.priority;
      });
    const complete = clients
      .filter((client) => client.status === 'complete')
      .sort((a, b) => {
        return a.priority - b.priority;
      });

    // Updating status and priority logic
    switch (client.status) {
      case 'backlog':
        backlog.splice(client.priority - 1, 1);
        break;

      case 'in-progress':
        inProgress.splice(client.priority - 1, 1);
        break;

      case 'complete':
        complete.splice(client.priority - 1, 1);
        break;

      default:
        break;
    }

    client.status = status;
    client.priority = priority;

    switch (status) {
      case 'backlog':
        backlog.splice(priority - 1, 0, client);
        break;

      case 'in-progress':
        inProgress.splice(priority - 1, 0, client);
        break;

      case 'complete':
        complete.splice(priority - 1, 0, client);
        break;

      default:
        break;
    }

    // Updating priority
    backlog.forEach((client, index) => {
      client.priority = index + 1;
      db.prepare(
        'update clients set status = ?, priority = ? where id = ?'
      ).run(client.status, client.priority, client.id);
    });

    inProgress.forEach((client, index) => {
      client.priority = index + 1;
      db.prepare(
        'update clients set status = ?, priority = ? where id = ?'
      ).run(client.status, client.priority, client.id);
    });

    complete.forEach((client, index) => {
      client.priority = index + 1;
      db.prepare(
        'update clients set status = ?, priority = ? where id = ?'
      ).run(client.status, client.priority, client.id);
    });

    clients = db.prepare('select * from clients').all();

    return res.status(200).send(clients);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Internal server error' });
  }
});

app.listen(3001);
console.log('app running on port ', 3001);
