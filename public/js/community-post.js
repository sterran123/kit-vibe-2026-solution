import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, getDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, updateDoc, deleteDoc,
  getDocs, addDoc
} from './firebase-init.js?v=4';

window.postDetailApp = function() {
  return {
    user: null,
    userRole: '',
    userPermissions: {},
    userInitials: '',
    photoURL: null,
    post: {},
    comments: [],
    newComment: '',
    showEditModal: false,
    editForm: { title: '', content: '' },
    quillEditor: null,
    
    // Reply
    replyingTo: null,
    replyContent: '',
    
    // Notifications & Profile
    showNotifications: false,
    showProfileDropdown: false,
    notifications: [],
    unreadCount: 0,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],

    async init() {
      dayjs.locale('ko');
      
      const urlParams = new URLSearchParams(window.location.search);
      const postId = urlParams.get('id');
      const type = urlParams.get('type');
      
      if (!postId) {
        window.location.href = 'community.html';
        return;
      }
      
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          window.location.href = 'login.html';
          return;
        }
        this.user = user;
        
        // Load user role and permissions
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          this.userRole = userData.role || '';
          this.userPermissions = userData.permissions || {};
        }
        this.userInitials = this.getInitials(user.displayName || user.email);
        
        // Load user profile photo
        const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
        if (profileDoc.exists()) {
          this.photoURL = profileDoc.data().photoURL || null;
        }
        
        // Load notifications
        this.loadNotifications(user.uid);
        
        this.loadPost(postId, type);
      });
    },

    async loadPost(postId, type) {
      try {
        let docRef;
        if (type === 'announcement') {
          docRef = doc(db, 'announcements', postId);
        } else {
          docRef = doc(db, 'posts', postId);
        }
        
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          Swal.fire({
            icon: 'error',
            title: '게시글을 찾을 수 없습니다',
            confirmButtonColor: '#2563eb'
          }).then(() => {
            window.location.href = 'community.html';
          });
          return;
        }
        
        this.post = {
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().created_at,
          isAnnouncement: type === 'announcement',
          collection: type === 'announcement' ? 'announcements' : 'posts'
        };
        
        // Increment view count (direct update)
        const currentViewCount = this.post.viewCount || 0;
        await updateDoc(docRef, {
          viewCount: currentViewCount + 1
        });
        
        this.loadComments(postId, type);
      } catch (error) {
        console.error('Load post error:', error);
      }
    },

    // Cache for author profile photos
    _authorPhotoCache: {},
    
    async getAuthorPhoto(authorId) {
      if (!authorId) return null;
      if (this._authorPhotoCache[authorId]) return this._authorPhotoCache[authorId];
      
      try {
        const profileDoc = await getDoc(doc(db, 'userProfiles', authorId));
        const photoURL = profileDoc.exists() ? profileDoc.data().photoURL || null : null;
        this._authorPhotoCache[authorId] = photoURL;
        return photoURL;
      } catch (err) {
        console.error('Error loading author photo:', err);
        return null;
      }
    },

    loadComments(postId, type) {
      const collectionPath = type === 'announcement' ? 'announcements' : 'posts';
      
      // Store reply unsubscribers to clean up old listeners
      if (!this._replyUnsubscribers) this._replyUnsubscribers = new Map();
      
      const q = query(
        collection(db, collectionPath, postId, 'comments'),
        orderBy('created_at', 'asc')
      );

      onSnapshot(q, async (snapshot) => {
        const comments = [];
        const activeCommentIds = new Set();
        
        // Collect all author IDs to batch load photos
        const authorIds = new Set();
        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.authorId) authorIds.add(data.authorId);
        });
        
        // Load missing author photos
        const missingIds = [...authorIds].filter(id => !this._authorPhotoCache[id]);
        await Promise.all(missingIds.map(id => this.getAuthorPhoto(id)));
        
        snapshot.docs.forEach((docSnap) => {
          const commentId = docSnap.id;
          activeCommentIds.add(commentId);
          const data = docSnap.data();
          
          const comment = {
            id: commentId,
            ...data,
            createdAt: data.created_at,
            photoURL: this._authorPhotoCache[data.authorId] || null,
            replies: []
          };
          
          // Check if we already have a listener for this comment's replies
          if (!this._replyUnsubscribers.has(commentId)) {
            // Set up real-time replies listener
            const repliesQ = query(
              collection(db, collectionPath, postId, 'comments', commentId, 'replies'),
              orderBy('created_at', 'asc')
            );
            
            const unsubscribe = onSnapshot(repliesQ, async (repliesSnap) => {
              const commentIndex = this.comments.findIndex(c => c.id === commentId);
              if (commentIndex !== -1) {
                // Collect reply author IDs
                const replyAuthorIds = new Set();
                repliesSnap.docs.forEach(r => {
                  const data = r.data();
                  if (data.authorId) replyAuthorIds.add(data.authorId);
                });
                
                // Load missing author photos
                const missingReplyIds = [...replyAuthorIds].filter(id => !this._authorPhotoCache[id]);
                await Promise.all(missingReplyIds.map(id => this.getAuthorPhoto(id)));
                
                this.comments[commentIndex].replies = repliesSnap.docs.map(r => {
                  const data = r.data();
                  return {
                    id: r.id,
                    ...data,
                    createdAt: data.created_at,
                    photoURL: this._authorPhotoCache[data.authorId] || null
                  };
                });
                // Force Alpine reactivity
                this.comments = [...this.comments];
              }
            });
            
            this._replyUnsubscribers.set(commentId, unsubscribe);
          }
          
          // Get current replies if already loaded
          const existingComment = this.comments.find(c => c.id === commentId);
          if (existingComment) {
            comment.replies = existingComment.replies;
          }
          
          comments.push(comment);
        });
        
        // Clean up listeners for removed comments
        this._replyUnsubscribers.forEach((unsubscribe, commentId) => {
          if (!activeCommentIds.has(commentId)) {
            unsubscribe();
            this._replyUnsubscribers.delete(commentId);
          }
        });
        
        this.comments = comments;
      });
    },

    canEditPost() {
      return this.post.authorId === this.user?.uid;
    },

    canDeletePost() {
      // Author can delete their own post
      if (this.post.authorId === this.user?.uid) return true;
      
      // Admin can delete any post
      if (this.userRole === 'admin') return true;
      
      // Instructor can delete any post
      if (this.userRole === 'instructor') return true;
      
      // Staff with deletePost permission can delete
      if (this.userRole === 'staff' && this.userPermissions?.deletePost) return true;
      
      return false;
    },

    canDeleteComment(comment) {
      // Author can delete their own comment
      if (comment.authorId === this.user?.uid) return true;
      
      // Admin can delete any comment
      if (this.userRole === 'admin') return true;
      
      // Instructor can delete any comment
      if (this.userRole === 'instructor') return true;
      
      // Staff with deleteComment permission can delete
      if (this.userRole === 'staff' && this.userPermissions?.deleteComment) return true;
      
      return false;
    },

    openEditModal() {
      this.editForm = {
        title: this.post.title,
        content: this.post.content
      };
      this.showEditModal = true;
      this.$nextTick(() => {
        this.initQuillEditor();
      });
    },

    initQuillEditor() {
      const editorContainer = document.getElementById('edit-editor');
      if (!editorContainer) return;
      
      if (this.quillEditor) {
        this.quillEditor = null;
        editorContainer.innerHTML = '';
      }
      
      this.quillEditor = new Quill('#edit-editor', {
        theme: 'snow',
        placeholder: '내용을 입력하세요...',
        modules: {
          toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'align': [] }],
            ['link', 'image'],
            ['clean']
          ]
        }
      });
      
      this.quillEditor.root.innerHTML = this.editForm.content;
      
      this.quillEditor.on('text-change', () => {
        this.editForm.content = this.quillEditor.root.innerHTML;
      });
    },

    async updatePost() {
      if (!this.editForm.title.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '제목을 입력하세요',
          confirmButtonColor: '#2563eb'
        });
        return;
      }

      const content = this.quillEditor ? this.quillEditor.root.innerHTML : this.editForm.content;

      try {
        await updateDoc(doc(db, this.post.collection, this.post.id), {
          title: this.editForm.title.trim(),
          content: content,
          updated_at: serverTimestamp()
        });

        this.post.title = this.editForm.title.trim();
        this.post.content = content;
        
        this.showEditModal = false;
        this.quillEditor = null;

        Swal.fire({
          icon: 'success',
          title: '수정 완료',
          timer: 1200,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Update post error:', error);
        Swal.fire({
          icon: 'error',
          title: '수정 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async deletePost() {
      const result = await Swal.fire({
        icon: 'warning',
        title: '게시글을 삭제하시겠습니까?',
        text: '삭제 후 복구할 수 없습니다.',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      try {
        // Delete all comments and replies
        const commentsQ = query(collection(db, this.post.collection, this.post.id, 'comments'));
        const commentsSnap = await getDocs(commentsQ);
        
        for (const comment of commentsSnap.docs) {
          // Delete replies
          const repliesQ = query(collection(db, this.post.collection, this.post.id, 'comments', comment.id, 'replies'));
          const repliesSnap = await getDocs(repliesQ);
          
          for (const reply of repliesSnap.docs) {
            await deleteDoc(doc(db, this.post.collection, this.post.id, 'comments', comment.id, 'replies', reply.id));
          }
          
          // Delete comment
          await deleteDoc(doc(db, this.post.collection, this.post.id, 'comments', comment.id));
        }

        // Delete post
        await deleteDoc(doc(db, this.post.collection, this.post.id));

        Swal.fire({
          icon: 'success',
          title: '삭제 완료',
          timer: 1200,
          showConfirmButton: false
        }).then(() => {
          window.location.href = 'community.html';
        });
      } catch (error) {
        console.error('Delete post error:', error);
        Swal.fire({
          icon: 'error',
          title: '삭제 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async addComment() {
      if (!this.newComment.trim()) return;

      try {
        await addDoc(collection(db, this.post.collection, this.post.id, 'comments'), {
          content: this.newComment.trim(),
          authorId: this.user.uid,
          authorName: this.user.displayName || this.user.email.split('@')[0],
          created_at: serverTimestamp()
        });

        // Create notification for post author (if not commenting on own post)
        if (this.post.authorId !== this.user.uid) {
          await this.createNotification({
            recipientId: this.post.authorId,
            type: 'comment',
            title: '새 댓글',
            message: `${this.user.displayName || this.user.email.split('@')[0]}님이 게시글에 댓글을 남겼습니다`,
            postId: this.post.id,
            postType: this.post.isAnnouncement ? 'announcement' : 'post',
            postTitle: this.post.title,
            commenterName: this.user.displayName || this.user.email.split('@')[0]
          });
        }

        this.newComment = '';
      } catch (error) {
        console.error('Add comment error:', error);
        Swal.fire({
          icon: 'error',
          title: '댓글 등록 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    replyToComment(comment) {
      this.replyingTo = comment.id;
      this.replyContent = '';
    },

    cancelReply() {
      this.replyingTo = null;
      this.replyContent = '';
    },

    async addReply(commentId) {
      if (!this.replyContent.trim()) return;

      try {
        // Get comment author first
        const commentDoc = await getDoc(doc(db, this.post.collection, this.post.id, 'comments', commentId));
        console.log('[AddReply] Comment doc:', commentDoc.exists(), commentDoc.data());
        const commentAuthorId = commentDoc.exists() ? commentDoc.data().authorId : null;
        console.log('[AddReply] Comment author ID:', commentAuthorId, 'Current user:', this.user.uid);

        await addDoc(collection(db, this.post.collection, this.post.id, 'comments', commentId, 'replies'), {
          content: this.replyContent.trim(),
          authorId: this.user.uid,
          authorName: this.user.displayName || this.user.email.split('@')[0],
          created_at: serverTimestamp()
        });

        // Create notification for comment author (if not replying to own comment)
        console.log('[AddReply] Should create notification?', commentAuthorId, commentAuthorId !== this.user.uid);
        if (commentAuthorId && commentAuthorId !== this.user.uid) {
          console.log('[AddReply] Creating reply notification for:', commentAuthorId);
          await this.createNotification({
            recipientId: commentAuthorId,
            type: 'reply',
            title: '새 답글',
            message: `${this.user.displayName || this.user.email.split('@')[0]}님이 댓글에 답글을 남겼습니다`,
            postId: this.post.id,
            postType: this.post.isAnnouncement ? 'announcement' : 'post',
            postTitle: this.post.title,
            replierName: this.user.displayName || this.user.email.split('@')[0]
          });
        }

        this.replyContent = '';
        this.replyingTo = null;
      } catch (error) {
        console.error('Add reply error:', error);
        Swal.fire({
          icon: 'error',
          title: '답글 등록 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async deleteComment(commentId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '댓글을 삭제하시겠습니까?',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      try {
        // Delete replies first
        const repliesQ = query(collection(db, this.post.collection, this.post.id, 'comments', commentId, 'replies'));
        const repliesSnap = await getDocs(repliesQ);
        
        for (const reply of repliesSnap.docs) {
          await deleteDoc(doc(db, this.post.collection, this.post.id, 'comments', commentId, 'replies', reply.id));
        }
        
        // Delete comment
        await deleteDoc(doc(db, this.post.collection, this.post.id, 'comments', commentId));

        Swal.fire({
          icon: 'success',
          title: '삭제 완료',
          timer: 1000,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Delete comment error:', error);
      }
    },

    async deleteReply(commentId, replyId) {
      try {
        await deleteDoc(doc(db, this.post.collection, this.post.id, 'comments', commentId, 'replies', replyId));
      } catch (error) {
        console.error('Delete reply error:', error);
      }
    },

    async createNotification(notificationData) {
      try {
        console.log('[CreateNotification] Data:', notificationData);
        const docRef = await addDoc(collection(db, 'notifications'), {
          ...notificationData,
          read: false,
          created_at: serverTimestamp()
        });
        console.log('[CreateNotification] Success! ID:', docRef.id);
      } catch (error) {
        console.error('[CreateNotification] Error:', error);
      }
    },

    // Notification methods
    loadNotifications(userId) {
//      console.log('[LoadNotifications] Loading for user:', userId);
      this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
      this.notificationUnsubscribes = [];
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];

      const subscribeByField = (fieldName, targetKey) => {
        const q = query(
          collection(db, 'notifications'),
          where(fieldName, '==', userId),
          where('read', '==', false),
          orderBy('created_at', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
          this[targetKey] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          this.mergeNotifications();
          console.log(`[LoadNotifications] ${fieldName} loaded:`, this[targetKey].length);
        }, (err) => {
          console.error(`[LoadNotifications] Error (${fieldName}):`, err);
          this[targetKey] = [];
          this.mergeNotifications();
        });
        this.notificationUnsubscribes.push(unsubscribe);
      };

      subscribeByField('user_id', 'notificationLegacyItems');
      subscribeByField('recipientId', 'notificationRecipientItems');
    },

    mergeNotifications() {
      const merged = [...this.notificationLegacyItems, ...this.notificationRecipientItems];
      const deduped = Array.from(new Map(merged.map(item => [item.id, item])).values());
      deduped.sort((a, b) => this.getNotificationTimestamp(b) - this.getNotificationTimestamp(a));
      this.notifications = deduped;
      this.unreadCount = deduped.length;
    },

    getNotificationTimestamp(notification) {
      const value = notification?.created_at || notification?.createdAt;
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') return value.seconds * 1000;
      return new Date(value).getTime() || 0;
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const lessonId = notification.lessonId || notification.lesson_id;
      const postId = notification.postId || notification.post_id;
      const postType = notification.postType || notification.post_type || 'post';
      const ticketId = notification.ticketId || notification.ticket_id;

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }
      if (ticketId) {
        return `my-tickets.html?ticketId=${ticketId}`;
      }
      if (courseId) {
        return lessonId
          ? `classroom.html?courseId=${courseId}&lessonId=${lessonId}`
          : `classroom.html?courseId=${courseId}`;
      }
      if (notification.link) {
        return notification.link;
      }
      return null;
    },
    
    async deleteNotification(notification) {
      try {
        await updateDoc(doc(db, 'notifications', notification.id), { read: true });
        this.notifications = this.notifications.filter(n => n.id !== notification.id);
        this.unreadCount = this.notifications.length;
      } catch (err) {
        console.error('Delete notification error:', err);
      }
    },

    async markAllNotificationsRead() {
      try {
        const batch = writeBatch(db);
        this.notifications.forEach(n => {
          const ref = doc(db, 'notifications', n.id);
          batch.update(ref, { read: true });
        });
        await batch.commit();
        this.notifications = [];
        this.unreadCount = 0;
      } catch (err) {
        console.error('Mark all notifications read error:', err);
      }
    },

    async handleNotificationClick(notification) {
      // Mark as read
      await updateDoc(doc(db, 'notifications', notification.id), { read: true });
      this.showNotifications = false;

      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;
      this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
      this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },

    async handleNotification(notification) {
      await this.handleNotificationClick(notification);
    },

    formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return dayjs(date).format('YYYY.MM.DD HH:mm');
    },

    getInitials(name) {
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    },

    async logout() {
      await signOut(auth);
      window.location.href = 'login.html';
    }
  };
};
