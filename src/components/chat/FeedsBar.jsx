import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { UserIcon } from '@heroicons/react/24/solid';
import { listFeed, subscribeFeed, isFeedAvailable } from '../../lib/feeds';

export default function FeedsBar() {
  const [feeds, setFeeds] = useState([]);
  const available = isFeedAvailable();
  const navigate = useNavigate();

  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    const load = async () => {
      try {
        const next = await listFeed();
        if (active) setFeeds(next);
      } catch {
        if (active) setFeeds([]);
      }
    };
    load();
    const unsubscribe = subscribeFeed(load);
    return () => { active = false; unsubscribe(); };
  }, [available]);

  // Only surface currently visible posts in the preview strip.
  const preview = feeds.filter((feed) => feed.status === 'active').slice(0, 5);

  return (
    <div className="border-b border-border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground">Feeds</h3>
        <button 
          onClick={() => navigate('/app/feeds')} 
          className="text-primary text-sm hover:underline"
        >
          View All
        </button>
      </div>
      {preview.length === 0 ? (
        <button
          onClick={() => navigate('/app/feeds')}
          className="w-full rounded-lg border border-dashed border-border py-3 text-xs text-muted-foreground hover:bg-muted transition"
        >
          No posts yet — be the first to share something
        </button>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {/* Recent Feeds Previews */}
          {preview.map(feed => (
            <button 
              key={feed.id} 
              onClick={() => navigate('/app/feeds')} 
              className="flex flex-col items-center gap-1 hover:opacity-80 transition"
            >
              <div className="relative">
                {feed.userAvatar ? (
                  <img src={feed.userAvatar} alt={feed.userName} className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <UserIcon className="w-8 h-8 text-primary" />
                  </div>
                )}
                {feed.isAdminPost && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <span className="text-primary-foreground text-[10px] font-bold">A</span>
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground text-center w-16 truncate">
                {feed.userName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
