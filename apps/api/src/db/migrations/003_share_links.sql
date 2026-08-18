-- ══════════ 공유 묶음 ══════════
--
-- 지금까지 공유는 폴더 행에 붙어 있었다 (folders.pub + folders.share_token).
-- 그래서 링크 하나가 가리킬 수 있는 건 언제나 폴더 하나였고,
-- "최상위 + 고른 하위 폴더들"을 한 링크로 여는 게 구조적으로 불가능했다.
--
-- 공유를 폴더에서 떼어내 **묶음**으로 만든다.
--   · 한 모임에 용도별로 여러 개 (부모님께 / 동반모임)
--   · 묶음마다 포함할 폴더를 골라 담는다
--   · 폴더 하나가 여러 묶음에 동시에 들어갈 수 있다
--   · 묶음을 중지하면 그 링크만 죽는다
--
-- ⚠ 토큰은 폴더 id 나 묶음 id 에서 파생시키지 않는다.
--   중지했다가 다시 공유했을 때 예전에 뿌린 링크가 되살아나면 안 되기 때문에,
--   공유할 때마다 난수로 새로 뽑는다. 이 규칙은 폴더 시절부터 그대로다.
--
-- ⚠ 밖으로 나가는 것은 여전히 미디어(사진·동영상)뿐이다.
--   문서·정산·일정은 이 묶음으로도 나가지 않는다.

CREATE TABLE share_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- "부모님께" 같은 이름. 어디에 뿌린 링크인지 나중에 알아보려고 둔다.
  label       text NOT NULL DEFAULT '',
  -- 난수. 이 값만이 링크를 연다.
  token       text NOT NULL UNIQUE,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_links_group_idx ON share_links(group_id);

-- 묶음에 담긴 폴더. include_descendants 가 참이면 그 폴더 아래 전부가 따라 나간다
-- (나중에 새로 만든 하위 폴더도 자동으로 포함된다 — 화면이 그 사실을 배지로 알린다).
CREATE TABLE share_link_folders (
  link_id             uuid NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  folder_id           uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  include_descendants boolean NOT NULL DEFAULT false,
  PRIMARY KEY (link_id, folder_id)
);
CREATE INDEX share_link_folders_folder_idx ON share_link_folders(folder_id);

-- ── 기존 공개 폴더를 묶음으로 옮긴다 ────────────────────────────────
-- 토큰을 그대로 물려받으므로 이미 뿌려 둔 링크가 죽지 않는다.
-- 폴더 하나짜리 묶음이고, 하위는 포함하지 않는다 — 지금 동작이 정확히 그랬다.
INSERT INTO share_links (group_id, label, token, created_by, created_at)
SELECT f.group_id, f.name, f.share_token, f.created_by, f.created_at
FROM folders f
WHERE f.pub = true AND f.share_token IS NOT NULL;

INSERT INTO share_link_folders (link_id, folder_id, include_descendants)
SELECT sl.id, f.id, false
FROM folders f
JOIN share_links sl ON sl.token = f.share_token
WHERE f.pub = true AND f.share_token IS NOT NULL;

-- ── 폴더에서 공유를 걷어낸다 ────────────────────────────────────────
-- 권한 규칙이 두 군데 있으면 언젠가 한쪽만 고쳐서 새어 나간다. 한 곳으로 모은다.
ALTER TABLE folders DROP CONSTRAINT IF EXISTS folders_pub_token_ck;
ALTER TABLE folders DROP COLUMN pub;
ALTER TABLE folders DROP COLUMN share_token;

COMMENT ON TABLE share_links IS
  '외부 공유 묶음. 밖으로 나가는 것은 여기에 담긴 폴더의 미디어뿐이다';
