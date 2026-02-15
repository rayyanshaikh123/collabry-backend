/**
 * Study Board Permission Tests
 * Tests for board access control and permissions
 */
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Board = require('../../src/models/Board');

describe('Study Board Permissions API', () => {
  let ownerToken;
  let memberToken;
  let nonMemberToken;
  let ownerId;
  let memberId;
  let nonMemberId;
  let boardId;

  beforeEach(async () => {
    // Create owner
    const ownerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Board Owner',
        email: 'owner@example.com',
        password: 'password123',
      });
    ownerToken = ownerResponse.body.data.accessToken;
    ownerId = ownerResponse.body.data.user.id;

    // Create member
    const memberResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Board Member',
        email: 'member@example.com',
        password: 'password123',
      });
    memberToken = memberResponse.body.data.accessToken;
    memberId = memberResponse.body.data.user.id;

    // Create non-member
    const nonMemberResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Non Member',
        email: 'nonmember@example.com',
        password: 'password123',
      });
    nonMemberToken = nonMemberResponse.body.data.accessToken;
    nonMemberId = nonMemberResponse.body.data.user.id;

    // Create a board as owner
    const board = await Board.create({
      name: 'Test Board',
      owner: ownerId,
      participants: [
        { user: ownerId, role: 'owner' },
        { user: memberId, role: 'editor' },
      ],
      isPublic: false,
    });
    boardId = board._id.toString();
  });

  describe('Board Access Control', () => {
    it('should allow owner to access private board', async () => {
      const response = await request(app)
        .get(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.board).toBeDefined();
    });

    it('should allow member to access private board', async () => {
      const response = await request(app)
        .get(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny non-member access to private board', async () => {
      const response = await request(app)
        .get(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Board Modification Permissions', () => {
    it('should allow owner to update board settings', async () => {
      const response = await request(app)
        .put(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Board Name' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.board.name).toBe('Updated Board Name');
    });

    it('should allow owner to delete board', async () => {
      const response = await request(app)
        .delete(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny member from deleting board', async () => {
      const response = await request(app)
        .delete(`/api/boards/${boardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Public Board Access', () => {
    let publicBoardId;

    beforeEach(async () => {
      const publicBoard = await Board.create({
        name: 'Public Board',
        owner: ownerId,
        participants: [{ user: ownerId, role: 'owner' }],
        isPublic: true,
      });
      publicBoardId = publicBoard._id.toString();
    });

    it('should allow anyone to view public board', async () => {
      const response = await request(app)
        .get(`/api/boards/${publicBoardId}`)
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Member Management', () => {
    it('should allow owner to add member', async () => {
      const newMemberResponse = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New Member',
          email: 'newmember@example.com',
          password: 'password123',
        });
      const newMemberId = newMemberResponse.body.data.user.id;

      const response = await request(app)
        .post(`/api/boards/${boardId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: newMemberId, role: 'viewer' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny member from adding other members', async () => {
      const newMemberResponse = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New Member 2',
          email: 'newmember2@example.com',
          password: 'password123',
        });
      const newMemberId = newMemberResponse.body.data.user.id;

      const response = await request(app)
        .post(`/api/boards/${boardId}/members`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ userId: newMemberId, role: 'viewer' })
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should allow owner to remove member', async () => {
      const response = await request(app)
        .delete(`/api/boards/${boardId}/members/${memberId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});
