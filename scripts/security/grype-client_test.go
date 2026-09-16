package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestSFCompletionMobyClient(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/_ping") {
			w.Header().Set("API-Version", "1.55")
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/images/json") {
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		called = true
		var filters map[string]map[string]bool
		if err := json.Unmarshal([]byte(r.URL.Query().Get("filters")), &filters); err != nil || !filters["dangling"]["false"] {
			t.Errorf("missing tagged-image filter: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"RepoTags":["sf:first","other:latest","sf:second"]}]`))
	}))
	defer server.Close()
	t.Setenv("DOCKER_HOST", server.URL)
	t.Setenv("DOCKER_API_VERSION", "1.55")
	t.Setenv("DOCKER_TLS_VERIFY", "")
	t.Setenv("DOCKER_CERT_PATH", "")
	tags, err := listLocalDockerImages("sf:")
	if err != nil || !called || !reflect.DeepEqual(tags, []string{"sf:first", "sf:second"}) {
		t.Fatalf("completion: tags=%v called=%v error=%v", tags, called, err)
	}
}

func TestSFCompletionUnavailableDaemon(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///tmp/sf-no-docker-daemon.sock")
	t.Setenv("DOCKER_API_VERSION", "1.55")
	t.Setenv("DOCKER_TLS_VERIFY", "")
	t.Setenv("DOCKER_CERT_PATH", "")
	tags, directive := dockerImageValidArgsFunction(nil, nil, "sf:")
	if len(tags) != 0 || directive != cobra.ShellCompDirectiveDefault {
		t.Fatalf("expected filename/subcommand fallback: %v %v", tags, directive)
	}
}
