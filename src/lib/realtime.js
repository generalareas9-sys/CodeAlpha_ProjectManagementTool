function emitProject(req, event, payload) {
  const io = req.app?.locals?.io;
  if (io && req.projectId) io.to(`project:${req.projectId}`).emit(event, payload);
}
function emitUser(req, userId, event, payload) {
  const io = req.app?.locals?.io;
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
}
module.exports = { emitProject, emitUser };
