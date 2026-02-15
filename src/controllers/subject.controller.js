class SubjectController {
  async getSubjects(req, res) {
    res.json({ success: true, data: [] });
  }

  async getSubjectById(req, res) {
    res.json({ success: true, data: null });
  }

  async createSubject(req, res) {
    res.json({ success: true, data: req.body });
  }

  async updateSubject(req, res) {
    res.json({ success: true, data: req.body });
  }

  async deleteSubject(req, res) {
    res.json({ success: true, message: 'Subject deleted' });
  }
}

module.exports = new SubjectController();
