using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSceneWalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "WallsJson",
                table: "Scenes",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WallsJson",
                table: "Scenes");
        }
    }
}
