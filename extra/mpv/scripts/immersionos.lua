local utils = require 'mp.utils'
local msg = require 'mp.msg'

local state_file = mp.command_native({"expand-path", "~~/"}) .. "/immersion_resume.json"
local initial_load = true
local current_percent = 0 
local current_folder = nil -- We memorize the folder here!

local function read_state()
    local f = io.open(state_file, "r")
    if not f then return {} end
    local content = f:read("*all")
    f:close()
    return utils.parse_json(content) or {}
end

local function write_state(state)
    local f = io.open(state_file, "w")
    if f then
        f:write(utils.format_json(state))
        f:close()
    end
end

-- Track the playback percentage in real-time
mp.observe_property("percent-pos", "number", function(name, val)
    if val then current_percent = val end
end)

-- 1. FOLDER RESUME LOGIC
mp.register_event("file-loaded", function()
    current_percent = 0 
    local path = mp.get_property("path")
    if not path then return end
    
    current_folder = string.match(path, "^(.+)[/\\][^/\\]+$")
    if not current_folder then return end

    local state = read_state()

    if initial_load then
        initial_load = false
        local playlist_count = mp.get_property_number("playlist-count", 0)
        
        if playlist_count > 1 and mp.get_property_number("playlist-pos", 0) == 0 then
            local saved_file = state[current_folder]
            if saved_file then
                for i = 0, playlist_count - 1 do
                    if mp.get_property("playlist/" .. i .. "/filename") == saved_file then
                        mp.set_property_number("playlist-pos", i)
                        return
                    end
                end
            end
        end
    end

    state[current_folder] = path
    write_state(state)
end)

-- 2. AUTO-LOG TO IMMERSION OS LOGIC
mp.register_event("end-file", function(e)
    if not current_folder then return end
    
    -- Log if the file ends naturally (eof) OR if you skipped after watching 85% of it!
    if e.reason == "eof" or ((e.reason == "stop" or e.reason == "quit") and current_percent > 85) then
        local url = "http://localhost:55002/log-ep"
        
        -- Send the raw text string to avoid Windows JSON quote-stripping bugs!
        mp.command_native_async({
            name = "subprocess",
            playback_only = false,
            args = {"curl", "-X", "POST", "-H", "Content-Type: text/plain", "-d", current_folder, url}
        }, function() end)
    end
end)